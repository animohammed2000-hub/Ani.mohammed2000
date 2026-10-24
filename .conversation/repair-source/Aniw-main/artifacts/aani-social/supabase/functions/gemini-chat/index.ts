import { handleGeminiRequest } from "../_shared/gemini.ts";

Deno.serve((req: Request) => handleGeminiRequest(req));
