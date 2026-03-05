'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function BacklogRedirect() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/workspace/${params.slug}?view=backlog`);
  }, [params.slug, router]);

  return null;
}
