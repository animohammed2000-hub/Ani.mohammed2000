import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface UserSuggestion {
  id: string;
  full_name: string;
  avatar_url?: string;
  city?: string;
}

export const useLocationSuggestions = (userCity?: string) => {
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!userCity) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, city')
        .eq('city', userCity)
        .limit(10);

      if (!error && data) {
        setSuggestions(data as UserSuggestion[]);
      }
      setLoading(false);
    };

    fetchSuggestions();
  }, [userCity]);

  return { suggestions, loading };
};
