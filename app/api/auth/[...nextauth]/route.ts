// where: app/api/auth/[...nextauth]/route.ts
// what:  Mount Auth.js v5 GET/POST handlers at /api/auth/*.
// why:   NextAuth v5 returns a `handlers` object from NextAuth(); destructure it here.

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
