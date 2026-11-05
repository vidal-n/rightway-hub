// Photos: clients send as many photos as they like in one go (client app). They land in the client's Photos tab, where the team
// makes a draft post from each one (captions are written the same way as the Posts tab). Shared by the client app and the Hub.
import { $, $$, esc, api, toast, busy, icon, fmt, resizeImage } from './core.js';
import { loadPosts } from './shared.js';

const CHUNK = 6; // photos per request, so a big batch never tries to go up in one piece

// The upload form. Works for clients (their own photos) and for the team (adds to the client's Photos tab).
export function photoUploader(el, clientId, { staff = false, onSent } = {}) {
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>${staff ? 'Add photos' : 'Send your photos'}</h2><span class="badge gray">Pick as many as you want</span></div>
      <form id="upf" class="form-grid">
        <label class="drop span-all" id="upf-drop">${icon.camera}<b>Take or choose photos</b><span class="small">One or many. Jobs, team, before and after, storefront.</span>
          <input type="file" name="photos" accept="image/*" multiple hidden></label>
        <div class="span-all ph-thumbs" id="upf-thumbs"></div>
        <label class="field span-all"><span>Anything to say about these? (optional)</span><textarea name="note" maxlength="1000" placeholder="e.g. Three roofs finished this week in Pembroke Pines"></textarea></label>
        <div class="span-all row end"><button class="btn btn-primary btn-xl" type="submit" id="upf-send" disabled>${icon.upload}Send photos</button></div>
      </form>
      <p class="small" style="margin-top:10px">${staff ? 'The photos show in the Photos tab. Make a post from each one when it is ready.' : 'We write the captions and post them, and you approve each one before it goes up.'}</p>
    </div>`;
  const form = $('#upf', el);
  const input = form.photos;
  const thumbs = $('#upf-thumbs', el);
  const send = $('#upf-send', el);
  let urls = [];
  const preview = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    const files = [...input.files];
    urls = files.slice(0, 12).map((f) => URL.createObjectURL(f));
    thumbs.innerHTML = files.length
      ? `${urls.map((u) => `<img src="${u}" alt="">`).join('')}${files.length > 12 ? `<span class="ph-more">+${files.length - 12}</span>` : ''}<span class="small ph-count">${files.length} photo${files.length === 1 ? '' : 's'} ready</span>`
      : '';
    send.disabled = !files.length;
  };
  input.addEventListener('change', preview);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = [...input.files];
    if (!files.length) return toast('Choose at least one photo.', true);
    const note = form.note.value.trim();
    let done = 0;
    busy(send, true, `Sending 0 of ${files.length}...`);
    try {
      for (let i = 0; i < files.length; i += CHUNK) {
        const part = files.slice(i, i + CHUNK);
        const fd = new FormData();
        for (const f of part) fd.append('photo', await resizeImage(f, 2000, 0.85));
        if (note) fd.append('note', note);
        await api(`/api/clients/${clientId}/photos`, { method: 'POST', form: fd });
        done += part.length;
        busy(send, true, `Sending ${done} of ${files.length}...`);
      }
      toast(staff ? `${done} photo${done === 1 ? '' : 's'} added` : `Sent ${done} photo${done === 1 ? '' : 's'}. We'll take it from here.`);
      form.reset();
      preview();
    } catch (err) {
      toast(done ? `${done} sent, then: ${err.message}` : err.message, true);
    } finally {
      busy(send, false);
      send.disabled = !input.files.length;
      onSent?.();
    }
  });
}

const tile = (p, clientId, staff) => `
  <figure class="ph-tile" data-id="${esc(p.id)}">
    <img src="/api/clients/${esc(clientId)}/photos/${esc(p.id)}/file" loading="lazy" alt="Photo">
    <figcaption>
      <span class="small muted">${esc(fmt.date(p.created_at))}</span>
      ${p.note ? `<span class="small">${esc(p.note)}</span>` : ''}
    </figcaption>
    <div class="ph-foot">
      ${p.post_id ? '<span class="badge">In posts</span>' : `<span class="badge ${staff ? 'warn' : 'gray'}">${staff ? 'Waiting' : 'Waiting for captions'}</span>`}
      ${staff && !p.post_id ? '<button class="btn btn-primary btn-sm" data-make>Make post</button>' : ''}
      ${staff ? '<button class="btn btn-ghost btn-sm" data-del>Delete</button>' : ''}
    </div>
  </figure>`;

// The grid. Staff can make a post from one photo or from all waiting photos, and delete a photo nobody will use.
async function photoGrid(box, clientId, staff, refresh) {
  box.innerHTML = '<div class="skeleton"></div>';
  let photos;
  try { ({ photos } = await api(`/api/clients/${clientId}/photos`)); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!photos.length) {
    box.innerHTML = `<div class="card empty"><h3>No photos yet</h3><p>${staff ? 'Photos the client sends show up here.' : 'Photos you send show up here.'}</p></div>`;
    return;
  }
  box.innerHTML = `<div class="ph-grid">${photos.map((p) => tile(p, clientId, staff)).join('')}</div>`;
  if (!staff) return;
  $$('[data-make]', box).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('.ph-tile').dataset.id;
    busy(b, true, 'Writing...');
    try { await api(`/api/clients/${clientId}/photos/${id}/post`, { method: 'POST' }); toast('Draft post ready in Posts.'); refresh(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this photo?')) return;
    const id = b.closest('.ph-tile').dataset.id;
    try { await api(`/api/clients/${clientId}/photos/${id}`, { method: 'DELETE' }); refresh(); }
    catch (err) { toast(err.message, true); }
  }));
}

// Client app: send photos, see what is waiting, approve the drafts that are ready.
export async function clientPhotosView(v, c) {
  v.innerHTML = '<div id="ph-up"></div><h2 class="sec-h">Your photos</h2><div id="ph-list"></div><h2 class="sec-h">Posts to approve</h2><div id="pl" class="posts"></div>';
  const refresh = () => { photoGrid($('#ph-list', v), c.id, false, refresh); loadPosts($('#pl', v), c.id, false, refresh); };
  photoUploader($('#ph-up', v), c.id, { onSent: refresh });
  refresh();
}

// Hub client profile, Photos tab.
export async function photosTab(el, c) {
  el.innerHTML = '<div id="ph-up"></div><div class="row end" id="ph-bar" style="margin:12px 0"></div><div id="ph-list"></div>';
  const refresh = async () => {
    photoGrid($('#ph-list', el), c.id, true, refresh);
    let waiting = [];
    try { waiting = (await api(`/api/clients/${c.id}/photos`)).photos.filter((p) => !p.post_id); } catch { /* the grid shows the error */ }
    const bar = $('#ph-bar', el);
    bar.innerHTML = waiting.length > 1 ? `<button class="btn btn-ghost btn-sm" id="ph-all">Make posts from all ${waiting.length} waiting</button>` : '';
    const all = $('#ph-all', el);
    all?.addEventListener('click', async () => {
      let made = 0;
      busy(all, true, 'Writing...');
      for (const p of waiting) {
        try { await api(`/api/clients/${c.id}/photos/${p.id}/post`, { method: 'POST' }); made++; busy(all, true, `Writing ${made} of ${waiting.length}...`); }
        catch (err) { toast(`${made} made, then: ${err.message}`, true); break; }
      }
      toast(`${made} draft post${made === 1 ? '' : 's'} ready in Posts.`);
      refresh();
    });
  };
  photoUploader($('#ph-up', el), c.id, { staff: true, onSent: refresh });
  refresh();
}
