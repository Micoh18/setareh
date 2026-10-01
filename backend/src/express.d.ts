declare module "express" {
  const express: any;
  export default express;
  export type ErrorRequestHandler = (error: unknown, request: any, response: any, next: any) => unknown;
}
