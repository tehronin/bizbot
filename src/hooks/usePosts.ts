"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const fetchPosts = useCallback(async (): Promise<PostRecord[]> => {
    const query = status ? `?status=${status}` : "";
    const response = await fetch(`/api/posts${query}`);
    const data = (await response.json()) as PostsResponse;
    return data.posts ?? [];
  }, [status]);

  const reload = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }

    setLoading(true);
    fetchPosts()
      .then((nextPosts) => {
        if (isMountedRef.current) {
          setPosts(nextPosts);
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setLoading(false);
        }
      });
  }, [fetchPosts]);

  useEffect(() => {
    let cancelled = false;

    void fetchPosts()
      .then((nextPosts) => {
        if (!cancelled) {
          setPosts(nextPosts);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchPosts]);

  return { posts, loading, reload };
}
