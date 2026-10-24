import { handleGeminiRequest } from "../_shared/gemini.ts";

// Legacy route: keep its { reply } response while requiring a valid user session.
Deno.serve((req: Request) => handleGeminiRequest(req, "reply"));
