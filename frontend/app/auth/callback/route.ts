import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { supabaseConfig } from "../config";

export async function GET(request: NextRequest) {
  const config = supabaseConfig();
  const code = request.nextUrl.searchParams.get("code");
  const failure = new URL("/?signin=failed", request.url);
  const response = NextResponse.redirect(new URL("/", request.url));
  response.headers.set("Cache-Control", "private, no-store");

  if (!config || !code) {
    response.headers.set("Location", failure.href);
    return response;
  }

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) response.headers.set("Location", failure.href);
  } catch {
    response.headers.set("Location", failure.href);
  }
  return response;
}
