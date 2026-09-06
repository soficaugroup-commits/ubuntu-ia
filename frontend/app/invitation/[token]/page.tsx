import { InvitationPasswordForm } from "@/components/auth/InvitationPasswordForm";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function InvitationPage({ params }: Props) {
  const { token } = await params;
  return <InvitationPasswordForm token={token} />;
}
