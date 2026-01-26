// Lightweight ambient type to avoid editor/ts complaints in this repo.
// We still ship @types/blessed as a devDependency; this file provides a
// permissive fallback in case the consumer environment cannot resolve the
// official types. It simply declares a default export of type `any`.
declare module 'blessed' {
  const blessed: any;
  export default blessed;
}
