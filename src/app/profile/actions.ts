"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/session-cookie";
import { field } from "@/lib/validation";

export type ProfileState = { error?: string; notice?: string };

export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const { supabase, user } = await requireUser("/profile");

  const fullName = field(formData, "full_name");
  if (fullName.length > 100) return { error: "Use a name of at most 100 characters." };

  // RLS also blocks editing anyone else's row; this filter just picks ours.
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName || null })
    .eq("id", user.id);
  if (error) {
    console.error("[profile] update failed", { code: error.code });
    return { error: "We couldn't save your profile. Please try again." };
  }

  revalidatePath("/profile");
  return { notice: "Saved." };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(SESSION_ONLY_COOKIE);
  redirect("/login");
}
