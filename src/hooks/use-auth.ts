import { useState } from "react";

interface UseAuthResult {
  user: any | null;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
  isLoading: boolean;
}

export function useAuth(): UseAuthResult {
  const [isLoading] = useState(false);

  return {
    user: null,
    isAuthenticated: false,
    signOut: async () => {},
    isLoading,
  };
}
