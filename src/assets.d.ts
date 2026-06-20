declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.webmanifest" {
  const content: string;
  export default content;
}

declare module "*.png" {
  const path: string;
  export default path;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
