export interface MovieItem {
  tmdbId: number;
  title: string;
  year?: number;
  posterUrl?: string | null;
  rating?: number;      
  popularity?: number;  
  providers?: {
    flatrate?: Array<{ id: number; name: string; logoUrl: string }>;
    rent?: Array<{ id: number; name: string; logoUrl: string }>;
    buy?: Array<{ id: number; name: string; logoUrl: string }>;
  };
  language?: string;
  genres?: string[];
}