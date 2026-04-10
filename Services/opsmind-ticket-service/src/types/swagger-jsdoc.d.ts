declare module "swagger-jsdoc" {
  import type { OpenAPIObject } from "openapi3-ts/oas30";

  export interface Options {
    definition?: Record<string, any>;
    apis: string[];
  }

  export { Options };

  export default function swaggerJSDoc(options: Options): OpenAPIObject;
}
