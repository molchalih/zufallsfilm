// Bun's bundler resolves a stylesheet import for its side effect and emits a
// stylesheet link; it has no module shape, and bun-types does not declare one.
declare module "*.css" {
  const href: string;
  export default href;
}

// Imported with `type: "file"`, which yields the asset's path at runtime rather
// than its contents.
declare module "*.png" {
  const path: string;
  export default path;
}
