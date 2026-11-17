import PrivateUpload from "./private-upload";

export default async function Home({ searchParams }: {
  searchParams: Promise<{ signin?: string }>;
}) {
  const query = await searchParams;
  return <PrivateUpload authFailed={query.signin === "failed"} />;
}
