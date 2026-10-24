import { handleGeminiRequest } from "../_shared/gemini.ts";

Deno.serve((request: Request) => handleGeminiRequest(request, "text"));
