import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { CLOUD } from "@/lib/config";
import { AuthFrame } from "../../AuthFrame";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  if (!CLOUD) redirect("/home");
  return (
    <AuthFrame>
      <SignIn />
    </AuthFrame>
  );
}
