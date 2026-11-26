import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(503, { error: "Authentication service is not configured." });
    }

    const body = await req.json();
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const bootstrapCode = String(body.bootstrap_code ?? "").trim();

    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      return jsonResponse(400, { error: "نام کاربری باید ۳ تا ۳۲ نویسه و شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد." });
    }
    if (password.length < 12 || password.length > 128) {
      return jsonResponse(400, { error: "رمز عبور باید حداقل ۱۲ و حداکثر ۱۲۸ نویسه داشته باشد." });
    }
    if (fullName.length < 2 || fullName.length > 100) {
      return jsonResponse(400, { error: "نام نمایشی معتبر وارد کنید." });
    }
    if (!/^[0-9a-f]{64}$/i.test(bootstrapCode)) {
      return jsonResponse(400, { error: "کد راه‌اندازی معتبر نیست." });
    }

    const tokenHash = await sha256Hex(bootstrapCode.toLowerCase());
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: tokenValid, error: tokenCheckError } = await admin.rpc(
      "fn_is_auth_bootstrap_token_valid",
      { p_token_hash: tokenHash }
    );
    if (tokenCheckError || tokenValid !== true) {
      return jsonResponse(403, {
        error: "کد راه‌اندازی نامعتبر، مصرف‌شده یا منقضی است.",
      });
    }

    const email = `${username}@farzam.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        bootstrap_token_hash: tokenHash,
      },
    });

    if (error || !data.user) {
      const alreadyExists = /already|registered|exists/i.test(error?.message ?? "");
      return jsonResponse(alreadyExists ? 409 : 400, {
        error: alreadyExists
          ? "این نام کاربری قبلاً ثبت شده است."
          : "ساخت حساب مدیر انجام نشد. کد راه‌اندازی را بررسی کنید.",
      });
    }

    const userId = data.user.id;
    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("role,is_active")
      .eq("id", userId)
      .maybeSingle();

    if (profileError || !profile || profile.role !== "ADMIN" || profile.is_active !== true) {
      await admin.auth.admin.deleteUser(userId);
      return jsonResponse(403, {
        error: "کد راه‌اندازی نامعتبر، مصرف‌شده یا منقضی است؛ هیچ حساب فعالی ایجاد نشد.",
      });
    }

    // Remove the one-time token hash from user metadata after the trigger consumes it.
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: fullName },
    });

    return jsonResponse(201, {
      ok: true,
      username,
      message_fa: "حساب مدیر اصلی با موفقیت ایجاد شد. اکنون می‌توانید وارد سامانه شوید.",
    });
  } catch {
    return jsonResponse(500, { error: "خطای داخلی هنگام راه‌اندازی مدیر اولیه." });
  }
});
