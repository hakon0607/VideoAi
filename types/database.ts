/**
 * Database types.
 *
 * Generated from the SQL in supabase/migrations and checked in, so the app type
 * checks without a live database. Regenerate with:
 *     npx supabase gen types typescript --project-id <id> > types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_messages: {
        Row: {
          id: string;
          conversation_id: string;
          project_id: string;
          user_id: string;
          role: string;
          content: string;
          actions: Json;
          descriptions: Json;
          status: string;
          error: string | null;
          model: string | null;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          credits_charged: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          project_id: string;
          user_id: string;
          role: string;
          content?: string;
          actions?: Json;
          descriptions?: Json;
          status?: string;
          error?: string | null;
          model?: string | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          credits_charged?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          project_id?: string;
          user_id?: string;
          role?: string;
          content?: string;
          actions?: Json;
          descriptions?: Json;
          status?: string;
          error?: string | null;
          model?: string | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          credits_charged?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      clips: {
        Row: {
          id: string;
          timeline_id: string;
          track_id: string;
          project_id: string;
          asset_id: string | null;
          kind: string;
          role: string;
          group_id: string | null;
          name: string;
          start_time: number;
          duration: number;
          source_in: number;
          speed: number;
          reversed: boolean;
          freeze_frame: boolean;
          volume: number;
          muted: boolean;
          fade_in: number;
          fade_out: number;
          opacity: number;
          locked: boolean;
          transform: Json;
          crop: Json | null;
          text_content: string | null;
          text_style: Json | null;
          text_animation: string | null;
          transition_in: Json | null;
          transition_out: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          timeline_id: string;
          track_id: string;
          project_id: string;
          asset_id?: string | null;
          kind: string;
          role?: string;
          group_id?: string | null;
          name?: string;
          start_time?: number;
          duration: number;
          source_in?: number;
          speed?: number;
          reversed?: boolean;
          freeze_frame?: boolean;
          volume?: number;
          muted?: boolean;
          fade_in?: number;
          fade_out?: number;
          opacity?: number;
          locked?: boolean;
          transform?: Json;
          crop?: Json | null;
          text_content?: string | null;
          text_style?: Json | null;
          text_animation?: string | null;
          transition_in?: Json | null;
          transition_out?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          timeline_id?: string;
          track_id?: string;
          project_id?: string;
          asset_id?: string | null;
          kind?: string;
          role?: string;
          group_id?: string | null;
          name?: string;
          start_time?: number;
          duration?: number;
          source_in?: number;
          speed?: number;
          reversed?: boolean;
          freeze_frame?: boolean;
          volume?: number;
          muted?: boolean;
          fade_in?: number;
          fade_out?: number;
          opacity?: number;
          locked?: boolean;
          transform?: Json;
          crop?: Json | null;
          text_content?: string | null;
          text_style?: Json | null;
          text_animation?: string | null;
          transition_in?: Json | null;
          transition_out?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      credit_costs: {
        Row: {
          key: string;
          cost: number;
          description: string;
        };
        Insert: {
          key: string;
          cost: number;
          description: string;
        };
        Update: {
          key?: string;
          cost?: number;
          description?: string;
        };
        Relationships: [];
      };
      credit_ledger: {
        Row: {
          id: string;
          user_id: string;
          delta: number;
          balance_after: number;
          reason: string;
          project_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta: number;
          balance_after: number;
          reason: string;
          project_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          delta?: number;
          balance_after?: number;
          reason?: string;
          project_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      editor_history: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          timeline_id: string | null;
          label: string;
          source: string;
          actions: Json;
          descriptions: Json;
          ai_message_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          timeline_id?: string | null;
          label: string;
          source?: string;
          actions?: Json;
          descriptions?: Json;
          ai_message_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          timeline_id?: string | null;
          label?: string;
          source?: string;
          actions?: Json;
          descriptions?: Json;
          ai_message_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      effects: {
        Row: {
          id: string;
          clip_id: string;
          project_id: string;
          type: string;
          enabled: boolean;
          order_index: number;
          params: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          clip_id: string;
          project_id: string;
          type: string;
          enabled?: boolean;
          order_index?: number;
          params?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          clip_id?: string;
          project_id?: string;
          type?: string;
          enabled?: boolean;
          order_index?: number;
          params?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      exports: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          status: string;
          progress: number;
          engine: string;
          settings: Json;
          output_path: string | null;
          size_bytes: number | null;
          error_message: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          status?: string;
          progress?: number;
          engine?: string;
          settings?: Json;
          output_path?: string | null;
          size_bytes?: number | null;
          error_message?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          status?: string;
          progress?: number;
          engine?: string;
          settings?: Json;
          output_path?: string | null;
          size_bytes?: number | null;
          error_message?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      keyframes: {
        Row: {
          id: string;
          clip_id: string;
          project_id: string;
          property: string;
          time_offset: number;
          value: number;
          easing: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          clip_id: string;
          project_id: string;
          property: string;
          time_offset: number;
          value: number;
          easing?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          clip_id?: string;
          project_id?: string;
          property?: string;
          time_offset?: number;
          value?: number;
          easing?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      media_analysis: {
        Row: {
          asset_id: string;
          project_id: string;
          language: string | null;
          transcript_text: string | null;
          words: Json;
          segments: Json;
          silences: Json;
          loudness_db: number | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          asset_id: string;
          project_id: string;
          language?: string | null;
          transcript_text?: string | null;
          words?: Json;
          segments?: Json;
          silences?: Json;
          loudness_db?: number | null;
          model?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          asset_id?: string;
          project_id?: string;
          language?: string | null;
          transcript_text?: string | null;
          words?: Json;
          segments?: Json;
          silences?: Json;
          loudness_db?: number | null;
          model?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      media_assets: {
        Row: {
          id: string;
          project_id: string;
          owner_id: string;
          kind: string;
          name: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          duration_seconds: number;
          width: number | null;
          height: number | null;
          fps: number | null;
          has_audio: boolean;
          sample_rate: number | null;
          channels: number | null;
          waveform: Json | null;
          thumbnail_url: string | null;
          analysis_status: string;
          analysis_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          owner_id: string;
          kind: string;
          name: string;
          storage_path: string;
          mime_type: string;
          size_bytes?: number;
          duration_seconds?: number;
          width?: number | null;
          height?: number | null;
          fps?: number | null;
          has_audio?: boolean;
          sample_rate?: number | null;
          channels?: number | null;
          waveform?: Json | null;
          thumbnail_url?: string | null;
          analysis_status?: string;
          analysis_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          owner_id?: string;
          kind?: string;
          name?: string;
          storage_path?: string;
          mime_type?: string;
          size_bytes?: number;
          duration_seconds?: number;
          width?: number | null;
          height?: number | null;
          fps?: number | null;
          has_audio?: boolean;
          sample_rate?: number | null;
          channels?: number | null;
          waveform?: Json | null;
          thumbnail_url?: string | null;
          analysis_status?: string;
          analysis_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          locale: string;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          aspect_ratio: string;
          width: number;
          height: number;
          fps: number;
          background_color: string;
          sample_rate: number;
          export_format: string;
          export_quality: string;
          thumbnail_path: string | null;
          duration_seconds: number;
          is_demo: boolean;
          last_opened_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name?: string;
          description?: string | null;
          aspect_ratio?: string;
          width?: number;
          height?: number;
          fps?: number;
          background_color?: string;
          sample_rate?: number;
          export_format?: string;
          export_quality?: string;
          thumbnail_path?: string | null;
          duration_seconds?: number;
          is_demo?: boolean;
          last_opened_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          description?: string | null;
          aspect_ratio?: string;
          width?: number;
          height?: number;
          fps?: number;
          background_color?: string;
          sample_rate?: number;
          export_format?: string;
          export_quality?: string;
          thumbnail_path?: string | null;
          duration_seconds?: number;
          is_demo?: boolean;
          last_opened_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      timelines: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          is_primary: boolean;
          revision: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name?: string;
          is_primary?: boolean;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          is_primary?: boolean;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tracks: {
        Row: {
          id: string;
          timeline_id: string;
          project_id: string;
          kind: string;
          name: string;
          layer_index: number;
          muted: boolean;
          hidden: boolean;
          locked: boolean;
          volume: number;
          height: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          timeline_id: string;
          project_id: string;
          kind: string;
          name: string;
          layer_index?: number;
          muted?: boolean;
          hidden?: boolean;
          locked?: boolean;
          volume?: number;
          height?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          timeline_id?: string;
          project_id?: string;
          kind?: string;
          name?: string;
          layer_index?: number;
          muted?: boolean;
          hidden?: boolean;
          locked?: boolean;
          volume?: number;
          height?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      user_credits: {
        Row: {
          user_id: string;
          balance: number;
          refill_amount: number;
          refill_interval: string;
          unlimited: boolean;
          lifetime_spent: number;
          last_refill_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          balance?: number;
          refill_amount?: number;
          refill_interval?: string;
          unlimited?: boolean;
          lifetime_spent?: number;
          last_refill_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          balance?: number;
          refill_amount?: number;
          refill_interval?: string;
          unlimited?: boolean;
          lifetime_spent?: number;
          last_refill_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      audio_elements: {
        Row: {
          id: string | null;
          project_id: string | null;
          timeline_id: string | null;
          track_id: string | null;
          asset_id: string | null;
          name: string | null;
          start_time: number | null;
          duration: number | null;
          source_in: number | null;
          speed: number | null;
          volume: number | null;
          muted: boolean | null;
          fade_in: number | null;
          fade_out: number | null;
        };
        Relationships: [];
      };
      captions: {
        Row: {
          id: string | null;
          project_id: string | null;
          timeline_id: string | null;
          track_id: string | null;
          group_id: string | null;
          start_time: number | null;
          duration: number | null;
          end_time: number | null;
          text_content: string | null;
          text_style: Json | null;
        };
        Relationships: [];
      };
      text_elements: {
        Row: {
          id: string | null;
          project_id: string | null;
          timeline_id: string | null;
          track_id: string | null;
          name: string | null;
          start_time: number | null;
          duration: number | null;
          text_content: string | null;
          text_style: Json | null;
          text_animation: string | null;
          transform: Json | null;
          opacity: number | null;
          role: string | null;
          group_id: string | null;
        };
        Relationships: [];
      };
      transitions: {
        Row: {
          clip_id: string | null;
          project_id: string | null;
          timeline_id: string | null;
          track_id: string | null;
          edge: string | null;
          type: string | null;
          duration: number | null;
          params: Json | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      create_project: {
        Args: {
          p_name?: string;
          p_aspect_ratio?: string;
          p_width?: number;
          p_height?: number;
          p_fps?: number;
        };
        Returns: string;
      };
      duplicate_project: { Args: { p_project_id: string; p_name?: string }; Returns: string };
      save_timeline: { Args: { p_payload: Json }; Returns: Json };
      get_credit_status: { Args: Record<string, never>; Returns: Json };
      consume_credits: {
        Args: { p_reason: string; p_amount?: number; p_project_id?: string; p_metadata?: Json };
        Returns: Json;
      };
      refund_credits: { Args: { p_reason: string; p_amount: number; p_project_id?: string }; Returns: Json };
      grant_credits: { Args: { p_user_id: string; p_amount: number; p_unlimited?: boolean }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
