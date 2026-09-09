import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function ReinitialisationPage({ params }: Props) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
