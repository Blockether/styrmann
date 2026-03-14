import { OrgDetailView } from '@/components/OrgDetailView';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function OrgDetailPage({ params }: Props) {
  const { slug } = await params;
  return <OrgDetailView slug={slug} />;
}
