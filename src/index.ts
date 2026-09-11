import { DurableObject } from "cloudflare:workers";

export class App extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
}
