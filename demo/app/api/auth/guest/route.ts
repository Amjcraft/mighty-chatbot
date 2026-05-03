import { signIn } from "@/app/(auth)/auth";
import { createGuestUser } from "@/lib/db/queries";

export async function GET() {
  const [guestUser] = await createGuestUser();
  await signIn("guest", { redirect: false });
  return Response.json({ id: guestUser.id });
}
