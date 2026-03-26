"use client";

import { useCallback, useEffect, useState } from "react";

export interface PostRecord {
  id: string;
  content: string;
  platformId: string;
  status: string;
  scheduledAt?: string | null;
  createdAt?: string;
}

interface PostsResponse {
  posts: PostRecord[];
}

export function usePosts(status?: string) {
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    const query = status ? `?status=${status}` : "";
    fetch(`/api/posts${query}`)
      .then((res) => res.json() as Promise<PostsResponse>)
      .then((data) => setPosts(data.posts ?? []))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { posts, loading, reload };
}
