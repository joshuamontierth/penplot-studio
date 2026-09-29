// Ambient types for the classic-script app. Modules share state through the window.PP namespace;
// it is `any` for now, so type checking covers each module's own code (see tsconfig.json).
declare global {
  interface Window {
    PP: any;
    PPTest: any;
  }
  const PP: any;
}
export {};
