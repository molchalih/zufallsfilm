// Bun's bundler resolves a stylesheet import for its side effect and emits a
// stylesheet link; it has no module shape, and bun-types does not declare one.
declare module "*.css" {
  const href: string;
  export default href;
}
