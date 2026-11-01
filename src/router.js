// Tiny route table shared by the Hub modules. Routes marked public skip the x-rw header (webhooks, public pages).
export const routes = [];
export function route(method, pattern, fn, opts = {}) {
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, public: Boolean(opts.public) });
}
