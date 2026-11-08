import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { CLOUD } from "@/lib/config";
import { AuthFrame } from "../../AuthFrame";

export const metadata = { title: "Create your account" };

export default function SignUpPage() {
  if (!CLOUD) redirect("/home");
  return (
    <AuthFrame>
      <SignUp />
    </AuthFrame>
  );
}
