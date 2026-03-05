'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ActivityRedirect() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/workspace/${params.slug}?view=activity`);
  }, [params.slug, router]);

  return null;
}
