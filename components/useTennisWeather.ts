'use client';

import { useEffect, useState } from 'react';
import type { TennisTour, WeatherContext } from '@/lib/core/types';

export interface TennisWeatherState {
  weather: WeatherContext | null;
  loading: boolean;
  error: string | null;
}

export function useTennisWeather(tour: TennisTour, venueCity: string | null): TennisWeatherState {
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const [loading, setLoading] = useState(Boolean(venueCity));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!venueCity) {
      setWeather(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const qs = new URLSearchParams({ venueCity });
        const res = await fetch(`/api/tennis/${tour}/weather?${qs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Tennis weather request failed (${res.status})`);
        setWeather(json.weather ?? null);
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [tour, venueCity]);

  return { weather, loading, error };
}

export default useTennisWeather;
