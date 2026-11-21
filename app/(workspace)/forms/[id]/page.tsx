import { FormView } from "@/components/database/FormView";

export const metadata = { title: "Form" };

export default async function Form({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormView databaseId={id} />;
}
