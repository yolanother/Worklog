// Lightweight ambient type to avoid editor/ts complaints in this repo.
// We still ship @types/blessed as a devDependency; this file provides a
// permissive fallback in case the consumer environment cannot resolve the
// official types. It simply declares a default export of type `any`.
declare module 'blessed' {
  export namespace Widgets {
    type Screen = any;
    type BoxElement = any;
    type ListElement = any;
    type TextareaElement = any;
    type TextElement = any;
    type TextboxElement = any;
  }
  const blessed: any;
  export default blessed;
}
