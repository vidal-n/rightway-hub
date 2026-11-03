// Slack message text to safe HTML, shared by the team's Slack page and the client Messages page, plus the emoji set
// (Slack's short names) for reactions, the picker and :name: in text. Workspace emoji are added with setCustomEmoji.
// Pure (no browser globals), so the Node tests load it too.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CATS = [
  ['Smileys', '😀', 'grinning:😀 smiley:😃 smile:😄 grin:😁 laughing:😆 sweat_smile:😅 rolling_on_the_floor_laughing:🤣 joy:😂 slightly_smiling_face:🙂 upside_down_face:🙃 melting_face:🫠 wink:😉 blush:😊 innocent:😇 smiling_face_with_3_hearts:🥰 heart_eyes:😍 star-struck:🤩 kissing_heart:😘 yum:😋 stuck_out_tongue:😛 stuck_out_tongue_winking_eye:😜 zany_face:🤪 money_mouth_face:🤑 hugging_face:🤗 face_with_hand_over_mouth:🤭 shushing_face:🤫 thinking_face:🤔 saluting_face:🫡 zipper_mouth_face:🤐 face_with_raised_eyebrow:🤨 neutral_face:😐 expressionless:😑 no_mouth:😶 smirk:😏 unamused:😒 face_with_rolling_eyes:🙄 grimacing:😬 relieved:😌 pensive:😔 sleepy:😪 sleeping:😴 mask:😷 face_with_thermometer:🤒 nauseated_face:🤢 sneezing_face:🤧 hot_face:🥵 cold_face:🥶 woozy_face:🥴 dizzy_face:😵 exploding_head:🤯 partying_face:🥳 sunglasses:😎 nerd_face:🤓 confused:😕 worried:😟 slightly_frowning_face:🙁 open_mouth:😮 hushed:😯 astonished:😲 flushed:😳 pleading_face:🥺 face_holding_back_tears:🥹 fearful:😨 cold_sweat:😰 cry:😢 sob:😭 scream:😱 confounded:😖 persevere:😣 disappointed:😞 sweat:😓 weary:😩 tired_face:😫 yawning_face:🥱 triumph:😤 rage:😡 angry:😠 skull:💀 hankey:💩 clown_face:🤡 ghost:👻 alien:👽 robot_face:🤖 smiley_cat:😺 see_no_evil:🙈 hear_no_evil:🙉 speak_no_evil:🙊'],
  ['People', '👋', 'wave:👋 raised_back_of_hand:🤚 hand:✋ spock-hand:🖖 ok_hand:👌 pinching_hand:🤏 v:✌️ crossed_fingers:🤞 i_love_you_hand_sign:🤟 the_horns:🤘 call_me_hand:🤙 point_left:👈 point_right:👉 point_up_2:👆 point_down:👇 point_up:☝️ +1:👍 -1:👎 fist:✊ facepunch:👊 left-facing_fist:🤛 right-facing_fist:🤜 clap:👏 raised_hands:🙌 open_hands:👐 palms_up_together:🤲 handshake:🤝 pray:🙏 writing_hand:✍️ muscle:💪 brain:🧠 eyes:👀 eye:👁️ tongue:👅 lips:👄 baby:👶 man:👨 woman:👩 older_man:👴 older_woman:👵 person_frowning:🙍 no_good:🙅 ok_woman:🙆 information_desk_person:💁 raising_hand:🙋 bow:🙇 face_palm:🤦 shrug:🤷 construction_worker:👷 dancer:💃 man_dancing:🕺 runner:🏃 walking:🚶 bust_in_silhouette:👤 busts_in_silhouette:👥 family:👪 speaking_head_in_silhouette:🗣️ footprints:👣'],
  ['Nature', '🌿', 'dog:🐶 cat:🐱 mouse:🐭 rabbit:🐰 fox_face:🦊 bear:🐻 panda_face:🐼 koala:🐨 tiger:🐯 lion_face:🦁 cow:🐮 pig:🐷 frog:🐸 monkey_face:🐵 chicken:🐔 penguin:🐧 bird:🐦 eagle:🦅 owl:🦉 bee:🐝 bug:🐛 butterfly:🦋 snail:🐌 turtle:🐢 snake:🐍 octopus:🐙 fish:🐟 whale:🐳 dolphin:🐬 shark:🦈 unicorn_face:🦄 horse:🐴 cactus:🌵 evergreen_tree:🌲 deciduous_tree:🌳 palm_tree:🌴 seedling:🌱 herb:🌿 four_leaf_clover:🍀 maple_leaf:🍁 fallen_leaf:🍂 mushroom:🍄 bouquet:💐 rose:🌹 tulip:🌷 sunflower:🌻 hibiscus:🌺 cherry_blossom:🌸 sun_with_face:🌞 crescent_moon:🌙 star:⭐ star2:🌟 dizzy:💫 sparkles:✨ zap:⚡ fire:🔥 boom:💥 sunny:☀️ partly_sunny:⛅ cloud:☁️ rain_cloud:🌧️ thunder_cloud_and_rain:⛈️ tornado:🌪️ snowflake:❄️ snowman:☃️ rainbow:🌈 umbrella:☔ droplet:💧 ocean:🌊 earth_americas:🌎'],
  ['Food', '🍔', 'apple:🍎 green_apple:🍏 pear:🍐 tangerine:🍊 lemon:🍋 banana:🍌 watermelon:🍉 grapes:🍇 strawberry:🍓 cherries:🍒 peach:🍑 pineapple:🍍 mango:🥭 coconut:🥥 kiwifruit:🥝 avocado:🥑 tomato:🍅 eggplant:🍆 hot_pepper:🌶️ corn:🌽 carrot:🥕 broccoli:🥦 bread:🍞 croissant:🥐 cheese_wedge:🧀 egg:🥚 fried_egg:🍳 bacon:🥓 pancakes:🥞 hamburger:🍔 fries:🍟 pizza:🍕 hotdog:🌭 sandwich:🥪 taco:🌮 burrito:🌯 poultry_leg:🍗 meat_on_bone:🍖 spaghetti:🍝 ramen:🍜 sushi:🍣 bento:🍱 rice:🍚 curry:🍛 shrimp:🦐 icecream:🍦 doughnut:🍩 cookie:🍪 birthday:🎂 cake:🍰 cupcake:🧁 chocolate_bar:🍫 candy:🍬 lollipop:🍭 popcorn:🍿 coffee:☕ tea:🍵 beer:🍺 beers:🍻 wine_glass:🍷 cocktail:🍸 tropical_drink:🍹 champagne:🍾 clinking_glasses:🥂 cup_with_straw:🥤 knife_fork_plate:🍽️'],
  ['Activity', '⚽', 'soccer:⚽ basketball:🏀 football:🏈 baseball:⚾ tennis:🎾 volleyball:🏐 golf:⛳ trophy:🏆 sports_medal:🏅 first_place_medal:🥇 second_place_medal:🥈 third_place_medal:🥉 medal:🎖️ dart:🎯 bowling:🎳 video_game:🎮 game_die:🎲 jigsaw:🧩 chess_pawn:♟️ art:🎨 performing_arts:🎭 microphone:🎤 headphones:🎧 musical_note:🎵 notes:🎶 guitar:🎸 musical_keyboard:🎹 drum_with_drumsticks:🥁 clapper:🎬 ticket:🎫 tada:🎉 confetti_ball:🎊 balloon:🎈 gift:🎁 ribbon:🎀 fireworks:🎆 sparkler:🎇 jack_o_lantern:🎃 christmas_tree:🎄 weight_lifter:🏋️ bicyclist:🚴 swimmer:🏊 surfer:🏄 skier:⛷️'],
  ['Travel', '🚗', 'car:🚗 taxi:🚕 blue_car:🚙 bus:🚌 truck:🚚 articulated_lorry:🚛 tractor:🚜 racing_car:🏎️ police_car:🚓 ambulance:🚑 fire_engine:🚒 bike:🚲 motor_scooter:🛵 motorcycle:🏍️ airplane:✈️ rocket:🚀 helicopter:🚁 boat:⛵ ship:🚢 anchor:⚓ train:🚆 fuelpump:⛽ construction:🚧 rotating_light:🚨 traffic_light:🚥 world_map:🗺️ compass:🧭 house:🏠 house_with_garden:🏡 office:🏢 hospital:🏥 bank:🏦 hotel:🏨 school:🏫 convenience_store:🏪 department_store:🏬 factory:🏭 church:⛪ stadium:🏟️ tent:⛺ beach_with_umbrella:🏖️ desert_island:🏝️ mountain:⛰️ snow_capped_mountain:🏔️ volcano:🌋 statue_of_liberty:🗽 city_sunset:🌆 night_with_stars:🌃 bridge_at_night:🌉 sunrise:🌅 round_pushpin:📍 pushpin:📌 globe_with_meridians:🌐'],
  ['Objects', '💡', 'watch:⌚ iphone:📱 calling:📲 computer:💻 keyboard:⌨️ desktop_computer:🖥️ printer:🖨️ three_button_mouse:🖱️ floppy_disk:💾 cd:💿 camera:📷 camera_with_flash:📸 video_camera:📹 movie_camera:🎥 tv:📺 radio:📻 phone:☎️ telephone_receiver:📞 pager:📟 fax:📠 battery:🔋 electric_plug:🔌 bulb:💡 flashlight:🔦 candle:🕯️ moneybag:💰 dollar:💵 money_with_wings:💸 credit_card:💳 gem:💎 scales:⚖️ wrench:🔧 hammer:🔨 hammer_and_wrench:🛠️ nut_and_bolt:🔩 gear:⚙️ toolbox:🧰 magnet:🧲 ladder:🪜 bricks:🧱 chains:⛓️ lock:🔒 unlock:🔓 key:🔑 old_key:🗝️ door:🚪 bed:🛏️ couch_and_lamp:🛋️ toilet:🚽 shower:🚿 bathtub:🛁 broom:🧹 basket:🧺 soap:🧼 sponge:🧽 shopping_trolley:🛒 hourglass:⌛ stopwatch:⏱️ alarm_clock:⏰ date:📅 calendar:📆 spiral_calendar_pad:🗓️ memo:📝 pencil2:✏️ lower_left_ballpoint_pen:🖊️ paperclip:📎 straight_ruler:📏 scissors:✂️ card_index_dividers:🗂️ file_folder:📁 open_file_folder:📂 clipboard:📋 page_facing_up:📄 bookmark_tabs:📑 chart_with_upwards_trend:📈 chart_with_downwards_trend:📉 bar_chart:📊 books:📚 book:📖 notebook:📓 ledger:📒 newspaper:📰 label:🏷️ email:✉️ e-mail:📧 incoming_envelope:📨 envelope_with_arrow:📩 outbox_tray:📤 inbox_tray:📥 package:📦 mailbox:📫 postbox:📮 link:🔗 mag:🔍 mag_right:🔎 microscope:🔬 telescope:🔭 satellite_antenna:📡 syringe:💉 pill:💊 stethoscope:🩺 shield:🛡️ bomb:💣 loudspeaker:📢 mega:📣 bell:🔔 no_bell:🔕 speech_balloon:💬 thought_balloon:💭 briefcase:💼 handbag:👜 eyeglasses:👓 dark_sunglasses:🕶️ necktie:👔 shirt:👕 jeans:👖 dress:👗 crown:👑 tophat:🎩 mortar_board:🎓 ring:💍 lipstick:💄'],
  ['Symbols', '❤️', 'heart:❤️ orange_heart:🧡 yellow_heart:💛 green_heart:💚 blue_heart:💙 purple_heart:💜 black_heart:🖤 white_heart:🤍 broken_heart:💔 heavy_heart_exclamation_mark_ornament:❣️ two_hearts:💕 revolving_hearts:💞 heartbeat:💓 heartpulse:💗 sparkling_heart:💖 cupid:💘 gift_heart:💝 100:💯 anger:💢 white_check_mark:✅ heavy_check_mark:✔️ ballot_box_with_check:☑️ x:❌ negative_squared_cross_mark:❎ heavy_plus_sign:➕ heavy_minus_sign:➖ heavy_division_sign:➗ heavy_multiplication_x:✖️ question:❓ grey_question:❔ exclamation:❗ grey_exclamation:❕ bangbang:‼️ interrobang:⁉️ warning:⚠️ no_entry:⛔ no_entry_sign:🚫 octagonal_sign:🛑 recycle:♻️ red_circle:🔴 large_orange_circle:🟠 large_yellow_circle:🟡 large_green_circle:🟢 large_blue_circle:🔵 large_purple_circle:🟣 black_circle:⚫ white_circle:⚪ large_red_square:🟥 arrow_up:⬆️ arrow_down:⬇️ arrow_left:⬅️ arrow_right:➡️ arrow_upper_right:↗️ arrow_lower_right:↘️ arrows_counterclockwise:🔄 repeat:🔁 arrow_forward:▶️ double_vertical_bar:⏸️ black_square_for_stop:⏹️ fast_forward:⏩ rewind:⏪ new:🆕 free:🆓 up:🆙 cool:🆒 ok:🆗 sos:🆘 top:🔝 soon:🔜 information_source:ℹ️ hash:#️⃣ one:1️⃣ two:2️⃣ three:3️⃣ four:4️⃣ five:5️⃣ keycap_ten:🔟 heavy_dollar_sign:💲 currency_exchange:💱 copyright:©️ registered:®️ tm:™️ triangular_flag_on_post:🚩 checkered_flag:🏁 flag-us:🇺🇸 white_flag:🏳️ zzz:💤 sweat_drops:💦 dash:💨 infinity:♾️ o:⭕ beginner:🔰 small_red_triangle:🔺 small_red_triangle_down:🔻 large_blue_diamond:🔷 large_orange_diamond:🔶 small_blue_diamond:🔹 small_orange_diamond:🔸'],
];

// Other names Slack uses for the same emoji.
const ALIASES = { thumbsup: '+1', thumbsdown: '-1', satisfied: 'laughing', punch: 'facepunch', raised_hand: 'hand', poop: 'hankey', shit: 'hankey', cheese: 'cheese_wedge', pencil: 'memo', envelope: 'email', telephone: 'phone',
  sailboat: 'boat', running: 'runner', honeybee: 'bee', sign_of_the_horns: 'the_horns', heavy_heart_exclamation: 'heavy_heart_exclamation_mark_ornament', grinning_face_with_star_eyes: 'star-struck', simple_smile: 'slightly_smiling_face',
  thinking: 'thinking_face', hugs: 'hugging_face', rofl: 'rolling_on_the_floor_laughing', slightly_frowning: 'slightly_frowning_face', facepalm: 'face_palm', man_shrugging: 'shrug', woman_shrugging: 'shrug', fist_raised: 'fist',
  car_red: 'car', red_car: 'car', heart_eyes_cat: 'smiley_cat', tired: 'tired_face', calendar_spiral: 'spiral_calendar_pad', check: 'heavy_check_mark', us: 'flag-us', moneybags: 'moneybag', lightning: 'zap', bulb_on: 'bulb' };

export const EMOJI_CATS = CATS.map(([name, icon, list]) => ({ name, icon, items: list.split(' ').map((p) => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; }) }));
export const EMOJI = Object.fromEntries(EMOJI_CATS.flatMap((c) => c.items));
for (const [a, b] of Object.entries(ALIASES)) if (!EMOJI[a] && EMOJI[b]) EMOJI[a] = EMOJI[b];

// The workspace's own emoji: name -> image URL, or "std:<name>" for a new name of a standard one.
let CUSTOM = {};
export function setCustomEmoji(map) { CUSTOM = map && typeof map === 'object' ? map : {}; }
export const customEmoji = () => CUSTOM;

// One emoji by name as HTML (a character, a workspace image, or the :name: text when unknown). Skin tones fall back to the plain one.
export function emojiHtml(name) {
  const n = String(name || '').split('::')[0].toLowerCase();
  if (EMOJI[n]) return EMOJI[n];
  const c = CUSTOM[n];
  if (c && c.startsWith('std:') && EMOJI[c.slice(4)]) return EMOJI[c.slice(4)];
  if (c && /^https:\/\//.test(c)) return `<img class="sl-emo" src="${esc(c)}" alt=":${esc(n)}:" title=":${esc(n)}:" loading="lazy">`;
  return `:${esc(n)}:`;
}

// Slack escapes &, < and > in message text. Undo that before escaping for HTML, so "&" shows as "&" (not "&amp;").
const unslack = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Slack text to safe HTML: escape everything, then add mentions, links, quotes, code, emoji and simple formatting.
export function slackHtml(text, people = {}, channels = {}) {
  const parts = [];
  let i = 0;
  const raw = String(text || '');
  for (const m of raw.matchAll(/<([^>\n]{1,500})>/g)) {
    parts.push({ t: raw.slice(i, m.index) });
    parts.push({ tok: m[1] });
    i = m.index + m[0].length;
  }
  parts.push({ t: raw.slice(i) });
  const fmtText = (s) => esc(unslack(s))
    .replace(/```([\s\S]+?)```/g, (_, c) => `<pre>${c.replace(/^\n/, '')}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, '$1<s>$2</s>')
    .replace(/:([a-z0-9_+'-]{1,60}(?:::skin-tone-\d)?):/g, (all, n) => { const h = emojiHtml(n); return h === `:${n.split('::')[0]}:` ? all : h; })
    .replace(/(^|\n)&gt; ?([^\n]*)/g, '$1<blockquote>$2</blockquote>')
    .replace(/<\/blockquote>\n<blockquote>/g, '<br>')
    .replace(/<\/blockquote>\n/g, '</blockquote>')
    .replace(/\n/g, '<br>');
  return parts.map((p) => {
    if (p.t != null) return fmtText(p.t);
    const [target, label] = p.tok.split('|');
    if (/^@[UW][A-Z0-9]+$/.test(target)) return `<span class="sl-mention" data-profile="${esc(target.slice(1))}">@${esc(people[target.slice(1)]?.name || label || 'someone')}</span>`;
    if (/^#[CG][A-Z0-9]+$/.test(target)) return `<a class="sl-mention" href="#/slack/${esc(target.slice(1))}">#${esc(label || channels[target.slice(1)] || 'channel')}</a>`;
    if (/^!subteam\^/.test(target)) return `<span class="sl-mention">${esc(label || '@group')}</span>`;
    if (/^!(here|channel|everyone)/.test(target)) return `<span class="sl-mention">@${esc(target.slice(1).split('^')[0])}</span>`;
    if (/^!date\^/.test(target)) return esc(label || '');
    if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) return `<a href="${esc(unslack(target))}" target="_blank" rel="noopener">${esc(unslack(label || target.replace(/^mailto:|^tel:/, '')))}</a>`;
    return esc(unslack(label || target));
  }).join('');
}

// Plain text for previews and copying (no markup).
export function slackPlain(text, people = {}) {
  return unslack(String(text || '')
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, l) => `@${people[id]?.name || l || 'someone'}`)
    .replace(/<#[CG][A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1'));
}

// What someone typed in the Hub to Slack's message format: escape &, < and >, turn picked @names and #channels (map of
// label -> token) into Slack mentions, @here/@channel/@everyone into Slack's specials, and [text](https://...) into links.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function toSlack(raw, map = new Map()) {
  const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let t = e(raw);
  for (const label of [...map.keys()].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`${escRe(e(label))}(?![\\w.-])`, 'g'), map.get(label));
  t = t.replace(/(^|[\s(])@(here|channel|everyone)\b/g, '$1<!$2>');
  t = t.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<$2|$1>');
  return t;
}

// Slack text back to what you type (names instead of ids), for editing. Fills the map so names turn back into mentions.
export function toEditable(text, map = new Map(), people = {}, channels = {}) {
  let t = String(text || '');
  t = t.replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => { const label = `@${people[id]?.name || 'someone'}`; map.set(label, `<@${id}>`); return label; });
  t = t.replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (all, id, name) => { const n = name || channels[id]; if (!n) return all; map.set(`#${n}`, `<#${id}|${n}>`); return `#${n}`; });
  t = t.replace(/<!(here|channel|everyone)[^>]*>/g, '@$1');
  t = t.replace(/<((?:https?:\/\/|mailto:)[^|>]+)\|([^>]+)>/g, '[$2]($1)');
  t = t.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1');
  return unslack(t);
}
