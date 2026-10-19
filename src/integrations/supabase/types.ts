export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _bra_backup: {
        Row: {
          booking_id: string | null
          created_at: string | null
          end_date: string | null
          id: string | null
          room_id: string | null
          start_date: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          room_id?: string | null
          start_date?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          room_id?: string | null
          start_date?: string | null
        }
        Relationships: []
      }
      _delta_backup: {
        Row: {
          booking_id: string | null
          created_at: string | null
          end_date: string | null
          id: string | null
          room_id: string | null
          start_date: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          room_id?: string | null
          start_date?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          room_id?: string | null
          start_date?: string | null
        }
        Relationships: []
      }
      _delta_orphan_assignments: {
        Row: {
          end_date: string | null
          pet_source_external_id: string | null
          reason: string | null
          room_name: string | null
          start_date: string | null
        }
        Insert: {
          end_date?: string | null
          pet_source_external_id?: string | null
          reason?: string | null
          room_name?: string | null
          start_date?: string | null
        }
        Update: {
          end_date?: string | null
          pet_source_external_id?: string | null
          reason?: string | null
          room_name?: string | null
          start_date?: string | null
        }
        Relationships: []
      }
      _orphan_assignments: {
        Row: {
          end_date: string | null
          pet_source_external_id: string | null
          reason: string | null
          room_name: string | null
          start_date: string | null
        }
        Insert: {
          end_date?: string | null
          pet_source_external_id?: string | null
          reason?: string | null
          room_name?: string | null
          start_date?: string | null
        }
        Update: {
          end_date?: string | null
          pet_source_external_id?: string | null
          reason?: string | null
          room_name?: string | null
          start_date?: string | null
        }
        Relationships: []
      }
      agent_capability_requests: {
        Row: {
          attempted_capability: string
          attempted_kind: string
          attempted_payload: Json | null
          chat_id: string | null
          created_at: string
          id: string
          status: string
          tenant_id: string | null
          trigger_message: string | null
        }
        Insert: {
          attempted_capability: string
          attempted_kind?: string
          attempted_payload?: Json | null
          chat_id?: string | null
          created_at?: string
          id?: string
          status?: string
          tenant_id?: string | null
          trigger_message?: string | null
        }
        Update: {
          attempted_capability?: string
          attempted_kind?: string
          attempted_payload?: Json | null
          chat_id?: string | null
          created_at?: string
          id?: string
          status?: string
          tenant_id?: string | null
          trigger_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_capability_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          draft_booking: Json | null
          facts: Json
          history: Json
          mode: string
          outcome: string | null
          owner_id: string | null
          owner_profile: string | null
          phone_number: string
          state: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          draft_booking?: Json | null
          facts?: Json
          history?: Json
          mode?: string
          outcome?: string | null
          owner_id?: string | null
          owner_profile?: string | null
          phone_number: string
          state?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          draft_booking?: Json | null
          facts?: Json
          history?: Json
          mode?: string
          outcome?: string | null
          owner_id?: string | null
          owner_profile?: string | null
          phone_number?: string
          state?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          chat_id: string | null
          created_at: string
          event: string
          id: string
          payload: Json
          tenant_id: string | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          event: string
          id?: string
          payload?: Json
          tenant_id?: string | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          event?: string
          id?: string
          payload?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_turns: {
        Row: {
          blocked_reason: string | null
          chat_id: string
          conversation_phone: string | null
          escalated: boolean
          id: string
          input_tokens: number | null
          latency_ms: number | null
          message_in: string | null
          message_out: string | null
          metadata: Json
          outcome: string | null
          output_tokens: number | null
          staff_notification: string | null
          started_at: string
          tenant_id: string | null
          tool_trace: string | null
        }
        Insert: {
          blocked_reason?: string | null
          chat_id: string
          conversation_phone?: string | null
          escalated?: boolean
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          message_in?: string | null
          message_out?: string | null
          metadata?: Json
          outcome?: string | null
          output_tokens?: number | null
          staff_notification?: string | null
          started_at?: string
          tenant_id?: string | null
          tool_trace?: string | null
        }
        Update: {
          blocked_reason?: string | null
          chat_id?: string
          conversation_phone?: string | null
          escalated?: boolean
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          message_in?: string | null
          message_out?: string | null
          metadata?: Json
          outcome?: string | null
          output_tokens?: number | null
          staff_notification?: string | null
          started_at?: string
          tenant_id?: string | null
          tool_trace?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_turns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_adjustments: {
        Row: {
          adjusted_amount: number | null
          adjustment_type: string
          approved_by: string
          booking_id: string | null
          created_at: string | null
          id: string
          invoice_id: string | null
          original_amount: number | null
          owner_id: string | null
          reason: string
        }
        Insert: {
          adjusted_amount?: number | null
          adjustment_type: string
          approved_by: string
          booking_id?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          original_amount?: number | null
          owner_id?: string | null
          reason: string
        }
        Update: {
          adjusted_amount?: number | null
          adjustment_type?: string
          approved_by?: string
          booking_id?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          original_amount?: number | null
          owner_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_adjustments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_adjustments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "billing_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_adjustments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      boarding_assignment_overrides: {
        Row: {
          booking_id: string
          created_at: string
          end_date: string | null
          id: string
          overridden_by: string | null
          reason: string
          room_id: string | null
          start_date: string | null
          warnings: Json
        }
        Insert: {
          booking_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          overridden_by?: string | null
          reason: string
          room_id?: string | null
          start_date?: string | null
          warnings?: Json
        }
        Update: {
          booking_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          overridden_by?: string | null
          reason?: string
          room_id?: string | null
          start_date?: string | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "boarding_assignment_overrides_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boarding_assignment_overrides_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "boarding_assignment_overrides_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_addons: {
        Row: {
          addon_type: Database["public"]["Enums"]["addon_type"]
          booking_id: string
          created_at: string
          description: string | null
          id: string
          notes: string | null
          quantity: number
          scheduled_date: string | null
          service_code: Database["public"]["Enums"]["service_code"] | null
          total_price: number | null
          unit_price: number | null
        }
        Insert: {
          addon_type: Database["public"]["Enums"]["addon_type"]
          booking_id: string
          created_at?: string
          description?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          scheduled_date?: string | null
          service_code?: Database["public"]["Enums"]["service_code"] | null
          total_price?: number | null
          unit_price?: number | null
        }
        Update: {
          addon_type?: Database["public"]["Enums"]["addon_type"]
          booking_id?: string
          created_at?: string
          description?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          scheduled_date?: string | null
          service_code?: Database["public"]["Enums"]["service_code"] | null
          total_price?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_addons_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_addons_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      booking_items: {
        Row: {
          booking_id: string
          category: string
          condition_notes: string | null
          created_at: string
          description: string
          id: string
          photo_urls: string[] | null
          quantity: number
          return_notes: string | null
          return_status: string | null
          returned: boolean | null
        }
        Insert: {
          booking_id: string
          category: string
          condition_notes?: string | null
          created_at?: string
          description: string
          id?: string
          photo_urls?: string[] | null
          quantity?: number
          return_notes?: string | null
          return_status?: string | null
          returned?: boolean | null
        }
        Update: {
          booking_id?: string
          category?: string
          condition_notes?: string | null
          created_at?: string
          description?: string
          id?: string
          photo_urls?: string[] | null
          quantity?: number
          return_notes?: string | null
          return_status?: string | null
          returned?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      booking_pets: {
        Row: {
          booking_id: string
          feeding_notes: string | null
          id: string
          medication_notes: string | null
          pet_id: string
          special_instructions: string | null
        }
        Insert: {
          booking_id: string
          feeding_notes?: string | null
          id?: string
          medication_notes?: string | null
          pet_id: string
          special_instructions?: string | null
        }
        Update: {
          booking_id?: string
          feeding_notes?: string | null
          id?: string
          medication_notes?: string | null
          pet_id?: string
          special_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_pets_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_pets_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_pets_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_room_assignments: {
        Row: {
          booking_id: string
          created_at: string | null
          end_date: string
          id: string
          room_id: string
          start_date: string
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          end_date: string
          id?: string
          room_id: string
          start_date: string
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          end_date?: string
          id?: string
          room_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_room_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_room_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_room_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          actual_check_in_at: string | null
          actual_check_out_at: string | null
          add_ons: string[] | null
          agent_notes: string | null
          boarding_type: Database["public"]["Enums"]["boarding_type"]
          booking_ref: string | null
          booking_type: Database["public"]["Enums"]["booking_type"] | null
          camera_link: string | null
          cancelled_reason: string | null
          check_in_date: string
          check_out_date: string
          created_at: string
          created_by: string | null
          do_not_move: boolean
          dropoff_required: boolean
          extended_from_booking_id: string | null
          id: string
          is_extension: boolean
          is_free_upgrade: boolean
          notes: string | null
          original_room_type: Database["public"]["Enums"]["room_type"] | null
          owner_id: string
          pickup_required: boolean
          room_id: string | null
          source_external_id: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          upgrade_reason: string | null
          upgraded_to_room_type: Database["public"]["Enums"]["room_type"] | null
        }
        Insert: {
          actual_check_in_at?: string | null
          actual_check_out_at?: string | null
          add_ons?: string[] | null
          agent_notes?: string | null
          boarding_type?: Database["public"]["Enums"]["boarding_type"]
          booking_ref?: string | null
          booking_type?: Database["public"]["Enums"]["booking_type"] | null
          camera_link?: string | null
          cancelled_reason?: string | null
          check_in_date: string
          check_out_date: string
          created_at?: string
          created_by?: string | null
          do_not_move?: boolean
          dropoff_required?: boolean
          extended_from_booking_id?: string | null
          id?: string
          is_extension?: boolean
          is_free_upgrade?: boolean
          notes?: string | null
          original_room_type?: Database["public"]["Enums"]["room_type"] | null
          owner_id: string
          pickup_required?: boolean
          room_id?: string | null
          source_external_id?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          upgrade_reason?: string | null
          upgraded_to_room_type?:
            | Database["public"]["Enums"]["room_type"]
            | null
        }
        Update: {
          actual_check_in_at?: string | null
          actual_check_out_at?: string | null
          add_ons?: string[] | null
          agent_notes?: string | null
          boarding_type?: Database["public"]["Enums"]["boarding_type"]
          booking_ref?: string | null
          booking_type?: Database["public"]["Enums"]["booking_type"] | null
          camera_link?: string | null
          cancelled_reason?: string | null
          check_in_date?: string
          check_out_date?: string
          created_at?: string
          created_by?: string | null
          do_not_move?: boolean
          dropoff_required?: boolean
          extended_from_booking_id?: string | null
          id?: string
          is_extension?: boolean
          is_free_upgrade?: boolean
          notes?: string | null
          original_room_type?: Database["public"]["Enums"]["room_type"] | null
          owner_id?: string
          pickup_required?: boolean
          room_id?: string | null
          source_external_id?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          upgrade_reason?: string | null
          upgraded_to_room_type?:
            | Database["public"]["Enums"]["room_type"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_extended_from_booking_id_fkey"
            columns: ["extended_from_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_extended_from_booking_id_fkey"
            columns: ["extended_from_booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "bookings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_checklists: {
        Row: {
          checklist_date: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          items: Json
          outstanding_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sign_offs: Json
          status: string
          updated_at: string
        }
        Insert: {
          checklist_date: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          items?: Json
          outstanding_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sign_offs?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          checklist_date?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          items?: Json
          outstanding_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sign_offs?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_checklists_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklists_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_notes: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          note_date: string
          note_text: string
          pet_id: string
          staff_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          note_date: string
          note_text: string
          pet_id: string
          staff_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          note_date?: string
          note_text?: string
          pet_id?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "daily_notes_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_notes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      daycare_sessions: {
        Row: {
          checked_in: boolean
          checked_in_at: string | null
          checked_out_at: string | null
          created_at: string
          dropoff_used: boolean
          id: string
          invoice_id: string | null
          logged_by: string | null
          notes: string | null
          owner_id: string
          package_id: string | null
          pet_id: string
          pickup_used: boolean
          remark: string | null
          session_date: string
          staff_id: string | null
        }
        Insert: {
          checked_in?: boolean
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string
          dropoff_used?: boolean
          id?: string
          invoice_id?: string | null
          logged_by?: string | null
          notes?: string | null
          owner_id: string
          package_id?: string | null
          pet_id: string
          pickup_used?: boolean
          remark?: string | null
          session_date: string
          staff_id?: string | null
        }
        Update: {
          checked_in?: boolean
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string
          dropoff_used?: boolean
          id?: string
          invoice_id?: string | null
          logged_by?: string | null
          notes?: string | null
          owner_id?: string
          package_id?: string | null
          pet_id?: string
          pickup_used?: boolean
          remark?: string | null
          session_date?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daycare_sessions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daycare_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daycare_sessions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daycare_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      feeding_logs: {
        Row: {
          created_at: string
          fed_at: string | null
          fed_by: string | null
          feeding_schedule_id: string
          id: string
          log_date: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          fed_at?: string | null
          fed_by?: string | null
          feeding_schedule_id: string
          id?: string
          log_date: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          fed_at?: string | null
          fed_by?: string | null
          feeding_schedule_id?: string
          id?: string
          log_date?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feeding_logs_fed_by_fkey"
            columns: ["fed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feeding_logs_feeding_schedule_id_fkey"
            columns: ["feeding_schedule_id"]
            isOneToOne: false
            referencedRelation: "feeding_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      feeding_schedules: {
        Row: {
          amount: string | null
          booking_id: string
          created_at: string
          food_type: string | null
          id: string
          meal_label: string
          meal_time: string | null
          pet_id: string
          special_instructions: string | null
        }
        Insert: {
          amount?: string | null
          booking_id: string
          created_at?: string
          food_type?: string | null
          id?: string
          meal_label: string
          meal_time?: string | null
          pet_id: string
          special_instructions?: string | null
        }
        Update: {
          amount?: string | null
          booking_id?: string
          created_at?: string
          food_type?: string | null
          id?: string
          meal_label?: string
          meal_time?: string | null
          pet_id?: string
          special_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feeding_schedules_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feeding_schedules_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "feeding_schedules_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_appointments: {
        Row: {
          appointment_date: string
          appointment_time: string | null
          booking_id: string | null
          coat_type: string | null
          completed_at: string | null
          created_at: string
          duration_minutes: number | null
          groomer_id: string | null
          grooming_notes: string | null
          id: string
          in_progress_at: string | null
          invoice_id: string | null
          must_finish_by: string | null
          no_show: boolean
          notes: string | null
          owner_id: string
          payment_method: string | null
          payment_migrated: boolean | null
          pet_id: string
          price: number | null
          service: Database["public"]["Enums"]["grooming_service"]
          station_id: string | null
          status: string
          visit_notes: string | null
        }
        Insert: {
          appointment_date: string
          appointment_time?: string | null
          booking_id?: string | null
          coat_type?: string | null
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          groomer_id?: string | null
          grooming_notes?: string | null
          id?: string
          in_progress_at?: string | null
          invoice_id?: string | null
          must_finish_by?: string | null
          no_show?: boolean
          notes?: string | null
          owner_id: string
          payment_method?: string | null
          payment_migrated?: boolean | null
          pet_id: string
          price?: number | null
          service: Database["public"]["Enums"]["grooming_service"]
          station_id?: string | null
          status?: string
          visit_notes?: string | null
        }
        Update: {
          appointment_date?: string
          appointment_time?: string | null
          booking_id?: string | null
          coat_type?: string | null
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          groomer_id?: string | null
          grooming_notes?: string | null
          id?: string
          in_progress_at?: string | null
          invoice_id?: string | null
          must_finish_by?: string | null
          no_show?: boolean
          notes?: string | null
          owner_id?: string
          payment_method?: string | null
          payment_migrated?: boolean | null
          pet_id?: string
          price?: number | null
          service?: Database["public"]["Enums"]["grooming_service"]
          station_id?: string | null
          status?: string
          visit_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grooming_appointments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "grooming_appointments_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "grooming_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_groomer_leave_periods: {
        Row: {
          created_at: string
          end_date: string
          groomer_id: string
          id: string
          note: string | null
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          groomer_id: string
          id?: string
          note?: string | null
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          groomer_id?: string
          id?: string
          note?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_groomer_leave_periods_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "grooming_groomers"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_groomer_weekly_days_off: {
        Row: {
          created_at: string
          day_of_week: number
          groomer_id: string
          id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          groomer_id: string
          id?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          groomer_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_groomer_weekly_days_off_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "grooming_groomers"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_groomers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      grooming_overrides: {
        Row: {
          appointment_id: string | null
          created_at: string
          id: string
          job_date: string
          overridden_by: string | null
          reason: string
          warnings: Json
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          job_date: string
          overridden_by?: string | null
          reason: string
          warnings?: Json
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          job_date?: string
          overridden_by?: string | null
          reason?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "grooming_overrides_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "grooming_appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_schedule_overrides: {
        Row: {
          appointment_id: string
          conflict_type: string
          conflicted_with_id: string
          created_at: string
          created_by: string | null
          id: string
          reason: string
        }
        Insert: {
          appointment_id: string
          conflict_type: string
          conflicted_with_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason: string
        }
        Update: {
          appointment_id?: string
          conflict_type?: string
          conflicted_with_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_schedule_overrides_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "grooming_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_schedule_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_service_durations: {
        Row: {
          default_minutes: number
          service: Database["public"]["Enums"]["grooming_service"]
          size: string
        }
        Insert: {
          default_minutes: number
          service: Database["public"]["Enums"]["grooming_service"]
          size: string
        }
        Update: {
          default_minutes?: number
          service?: Database["public"]["Enums"]["grooming_service"]
          size?: string
        }
        Relationships: []
      }
      grooming_station_blocks: {
        Row: {
          block_date: string
          created_at: string
          created_by: string | null
          end_time: string | null
          id: string
          is_full_day: boolean
          reason: string
          start_time: string | null
          station_id: string
        }
        Insert: {
          block_date: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          is_full_day?: boolean
          reason?: string
          start_time?: string | null
          station_id: string
        }
        Update: {
          block_date?: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          is_full_day?: boolean
          reason?: string
          start_time?: string | null
          station_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_station_blocks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_station_blocks_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "grooming_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_station_weekly_assignments: {
        Row: {
          created_at: string
          day_of_week: number
          groomer_id: string
          id: string
          station_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          groomer_id: string
          id?: string
          station_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          groomer_id?: string
          id?: string
          station_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_station_weekly_assignments_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "grooming_groomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_station_weekly_assignments_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "grooming_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_stations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      grooming_status_events: {
        Row: {
          appointment_id: string
          created_at: string
          from_status: string | null
          id: string
          to_status: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          to_status: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_status_events_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "grooming_appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_logs: {
        Row: {
          created_at: string
          handover_time: string
          id: string
          notes: string
          shift_date: string
          staff_id: string | null
        }
        Insert: {
          created_at?: string
          handover_time: string
          id?: string
          notes: string
          shift_date: string
          staff_id?: string | null
        }
        Update: {
          created_at?: string
          handover_time?: string
          id?: string
          notes?: string
          shift_date?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_logs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_amendments: {
        Row: {
          amended_at: string
          amended_by: string
          field_changed: string
          id: string
          invoice_id: string
          new_value: string | null
          old_value: string | null
          reason: string
        }
        Insert: {
          amended_at?: string
          amended_by: string
          field_changed: string
          id?: string
          invoice_id: string
          new_value?: string | null
          old_value?: string | null
          reason: string
        }
        Update: {
          amended_at?: string
          amended_by?: string
          field_changed?: string
          id?: string
          invoice_id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_amendments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_consolidation_log: {
        Row: {
          consolidated_invoice_id: string
          created_at: string
          id: string
          owner_id: string
          performed_by: string
          source_invoice_ids: string[]
        }
        Insert: {
          consolidated_invoice_id: string
          created_at?: string
          id?: string
          owner_id: string
          performed_by: string
          source_invoice_ids: string[]
        }
        Update: {
          consolidated_invoice_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          performed_by?: string
          source_invoice_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "invoice_consolidation_log_consolidated_invoice_id_fkey"
            columns: ["consolidated_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_consolidation_log_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_deletion_log: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          id: string
          invoice_id: string | null
          invoice_row_id: string | null
          owner_name: string | null
          reason: string | null
          total_amount: number | null
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          invoice_id?: string | null
          invoice_row_id?: string | null
          owner_name?: string | null
          reason?: string | null
          total_amount?: number | null
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          invoice_id?: string | null
          invoice_row_id?: string | null
          owner_name?: string | null
          reason?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_deletion_log_invoice_row_id_fkey"
            columns: ["invoice_row_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total: number | null
          pricing_key: string | null
          quantity: number
          service_type: string | null
          sort_order: number | null
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total?: number | null
          pricing_key?: string | null
          quantity?: number
          service_type?: string | null
          sort_order?: number | null
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number | null
          pricing_key?: string | null
          quantity?: number
          service_type?: string | null
          sort_order?: number | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          closing_balance: number
          created_at: string
          id: string
          invoice_id: string
          notes: string | null
          opening_balance: number
          owner_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          wallet_transaction_id: string | null
        }
        Insert: {
          amount: number
          closing_balance: number
          created_at?: string
          id?: string
          invoice_id: string
          notes?: string | null
          opening_balance: number
          owner_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
          wallet_transaction_id?: string | null
        }
        Update: {
          amount?: number
          closing_balance?: number
          created_at?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          opening_balance?: number
          owner_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments_backfill_20260603: {
        Row: {
          amount: number
          created_at: string
          invoice_id: string
          old_status: string | null
          payment_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          invoice_id: string
          old_status?: string | null
          payment_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          invoice_id?: string
          old_status?: string | null
          payment_id?: string
        }
        Relationships: []
      }
      invoice_payments_fix_emma_procter_20260606: {
        Row: {
          amount: number
          archived_at: string
          created_at: string
          invoice_id: string
          payment_id: string
          payment_method: string
        }
        Insert: {
          amount: number
          archived_at?: string
          created_at: string
          invoice_id: string
          payment_id: string
          payment_method: string
        }
        Update: {
          amount?: number
          archived_at?: string
          created_at?: string
          invoice_id?: string
          payment_id?: string
          payment_method?: string
        }
        Relationships: []
      }
      invoice_payments_reverted_archive: {
        Row: {
          amount: number
          archived_at: string
          archived_reason: string
          created_at: string | null
          invoice_id: string
          owner_id: string | null
          payment_id: string
          payment_method: string | null
          recorded_by: string | null
        }
        Insert: {
          amount: number
          archived_at?: string
          archived_reason?: string
          created_at?: string | null
          invoice_id: string
          owner_id?: string | null
          payment_id: string
          payment_method?: string | null
          recorded_by?: string | null
        }
        Update: {
          amount?: number
          archived_at?: string
          archived_reason?: string
          created_at?: string | null
          invoice_id?: string
          owner_id?: string | null
          payment_id?: string
          payment_method?: string | null
          recorded_by?: string | null
        }
        Relationships: []
      }
      invoice_status_migration_20260603: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          invoice_id: string
          invoice_number: string | null
          migrated_at: string
          new_status: string
          old_status: string
          owner_id: string | null
          total: number | null
        }
        Insert: {
          amount_paid?: number | null
          balance_due?: number | null
          invoice_id: string
          invoice_number?: string | null
          migrated_at?: string
          new_status?: string
          old_status: string
          owner_id?: string | null
          total?: number | null
        }
        Update: {
          amount_paid?: number | null
          balance_due?: number | null
          invoice_id?: string
          invoice_number?: string | null
          migrated_at?: string
          new_status?: string
          old_status?: string
          owner_id?: string | null
          total?: number | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amendment_locked_at: string | null
          amount_paid: number
          became_outstanding_at: string | null
          became_outstanding_by: string | null
          booking_id: string | null
          created_at: string
          deposit_bypass_reason: string | null
          deposit_bypassed: boolean | null
          discount_amount: number
          discount_pct: number
          due_date: string | null
          id: string
          invoice_number: string | null
          issue_date: string
          notes: string | null
          opening_balance: number | null
          owner_id: string
          paid_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          receipt_only: boolean | null
          service_id: string | null
          service_type: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          vat_aed: number | null
          voided_at: string | null
          voided_by: string | null
          voided_reason: string | null
        }
        Insert: {
          amendment_locked_at?: string | null
          amount_paid?: number
          became_outstanding_at?: string | null
          became_outstanding_by?: string | null
          booking_id?: string | null
          created_at?: string
          deposit_bypass_reason?: string | null
          deposit_bypassed?: boolean | null
          discount_amount?: number
          discount_pct?: number
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issue_date?: string
          notes?: string | null
          opening_balance?: number | null
          owner_id: string
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          receipt_only?: boolean | null
          service_id?: string | null
          service_type?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vat_aed?: number | null
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Update: {
          amendment_locked_at?: string | null
          amount_paid?: number
          became_outstanding_at?: string | null
          became_outstanding_by?: string | null
          booking_id?: string | null
          created_at?: string
          deposit_bypass_reason?: string | null
          deposit_bypassed?: boolean | null
          discount_amount?: number
          discount_pct?: number
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issue_date?: string
          notes?: string | null
          opening_balance?: number | null
          owner_id?: string
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          receipt_only?: boolean | null
          service_id?: string | null
          service_type?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vat_aed?: number | null
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "invoices_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_logs: {
        Row: {
          created_at: string
          given_at: string | null
          given_by: string | null
          id: string
          log_date: string
          medication_id: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          given_at?: string | null
          given_by?: string | null
          id?: string
          log_date: string
          medication_id: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          given_at?: string | null
          given_by?: string | null
          id?: string
          log_date?: string
          medication_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_logs_given_by_fkey"
            columns: ["given_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "stay_medications"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          address: string | null
          always_full_refund: boolean | null
          always_same_room: boolean
          billing_notes: string | null
          camera_required: boolean
          created_at: string
          customer_id: string | null
          deferred_payment: boolean | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emirates_id: string | null
          extra_discount_pct: number | null
          first_name: string
          how_heard: string | null
          id: string
          is_elite: boolean | null
          is_vip: boolean
          is_woof_owned: boolean
          last_name: string | null
          low_balance_threshold_override: number | null
          notes: string | null
          notify_birthday: boolean
          notify_boarding: boolean
          notify_boarding_reminder: boolean
          notify_daycare: boolean
          notify_grooming: boolean
          notify_vaccination: boolean
          other_notes: string | null
          phone: string | null
          phone2: string | null
          preferred_groomer: string | null
          source_external_id: string | null
          updated_at: string
          vet_name: string | null
          vet_phone: string | null
          wallet_balance: number
        }
        Insert: {
          address?: string | null
          always_full_refund?: boolean | null
          always_same_room?: boolean
          billing_notes?: string | null
          camera_required?: boolean
          created_at?: string
          customer_id?: string | null
          deferred_payment?: boolean | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emirates_id?: string | null
          extra_discount_pct?: number | null
          first_name: string
          how_heard?: string | null
          id?: string
          is_elite?: boolean | null
          is_vip?: boolean
          is_woof_owned?: boolean
          last_name?: string | null
          low_balance_threshold_override?: number | null
          notes?: string | null
          notify_birthday?: boolean
          notify_boarding?: boolean
          notify_boarding_reminder?: boolean
          notify_daycare?: boolean
          notify_grooming?: boolean
          notify_vaccination?: boolean
          other_notes?: string | null
          phone?: string | null
          phone2?: string | null
          preferred_groomer?: string | null
          source_external_id?: string | null
          updated_at?: string
          vet_name?: string | null
          vet_phone?: string | null
          wallet_balance?: number
        }
        Update: {
          address?: string | null
          always_full_refund?: boolean | null
          always_same_room?: boolean
          billing_notes?: string | null
          camera_required?: boolean
          created_at?: string
          customer_id?: string | null
          deferred_payment?: boolean | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emirates_id?: string | null
          extra_discount_pct?: number | null
          first_name?: string
          how_heard?: string | null
          id?: string
          is_elite?: boolean | null
          is_vip?: boolean
          is_woof_owned?: boolean
          last_name?: string | null
          low_balance_threshold_override?: number | null
          notes?: string | null
          notify_birthday?: boolean
          notify_boarding?: boolean
          notify_boarding_reminder?: boolean
          notify_daycare?: boolean
          notify_grooming?: boolean
          notify_vaccination?: boolean
          other_notes?: string | null
          phone?: string | null
          phone2?: string | null
          preferred_groomer?: string | null
          source_external_id?: string | null
          updated_at?: string
          vet_name?: string | null
          vet_phone?: string | null
          wallet_balance?: number
        }
        Relationships: []
      }
      package_credit_grants: {
        Row: {
          exclusive_group: string | null
          id: string
          is_bonus: boolean
          package_def_id: string
          service_code: Database["public"]["Enums"]["service_code"]
          sort_order: number
          units: number
        }
        Insert: {
          exclusive_group?: string | null
          id?: string
          is_bonus?: boolean
          package_def_id: string
          service_code: Database["public"]["Enums"]["service_code"]
          sort_order?: number
          units: number
        }
        Update: {
          exclusive_group?: string | null
          id?: string
          is_bonus?: boolean
          package_def_id?: string
          service_code?: Database["public"]["Enums"]["service_code"]
          sort_order?: number
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_credit_grants_package_def_id_fkey"
            columns: ["package_def_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      package_definitions: {
        Row: {
          applicable_species: Database["public"]["Enums"]["species"][]
          category: string
          code: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          multi_pet_discount_pct: number
          sort_order: number
          updated_at: string
          validity_months: number
        }
        Insert: {
          applicable_species?: Database["public"]["Enums"]["species"][]
          category: string
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          multi_pet_discount_pct?: number
          sort_order?: number
          updated_at?: string
          validity_months: number
        }
        Update: {
          applicable_species?: Database["public"]["Enums"]["species"][]
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          multi_pet_discount_pct?: number
          sort_order?: number
          updated_at?: string
          validity_months?: number
        }
        Relationships: []
      }
      package_pricing: {
        Row: {
          amount_aed: number
          coat_type: Database["public"]["Enums"]["coat_type"] | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean
          package_def_id: string
          pet_size: Database["public"]["Enums"]["pet_size"] | null
          updated_at: string
        }
        Insert: {
          amount_aed: number
          coat_type?: Database["public"]["Enums"]["coat_type"] | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          package_def_id: string
          pet_size?: Database["public"]["Enums"]["pet_size"] | null
          updated_at?: string
        }
        Update: {
          amount_aed?: number
          coat_type?: Database["public"]["Enums"]["coat_type"] | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          package_def_id?: string
          pet_size?: Database["public"]["Enums"]["pet_size"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_pricing_package_def_id_fkey"
            columns: ["package_def_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reminders: {
        Row: {
          amount_at_time: number
          channel: string
          id: string
          notes: string | null
          owner_id: string
          sent_at: string
          sent_by: string
        }
        Insert: {
          amount_at_time: number
          channel?: string
          id?: string
          notes?: string | null
          owner_id: string
          sent_at?: string
          sent_by: string
        }
        Update: {
          amount_at_time?: number
          channel?: string
          id?: string
          notes?: string | null
          owner_id?: string
          sent_at?: string
          sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reminders_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      peak_periods: {
        Row: {
          created_at: string
          end_date: string | null
          end_day: number
          end_month: number
          id: string
          is_active: boolean
          label: string
          notes: string | null
          start_date: string | null
          start_day: number
          start_month: number
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          end_day: number
          end_month: number
          id?: string
          is_active?: boolean
          label: string
          notes?: string | null
          start_date?: string | null
          start_day: number
          start_month: number
        }
        Update: {
          created_at?: string
          end_date?: string | null
          end_day?: number
          end_month?: number
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
          start_date?: string | null
          start_day?: number
          start_month?: number
        }
        Relationships: []
      }
      pet_grooming_notes: {
        Row: {
          appointment_id: string | null
          created_at: string
          id: string
          note: string
          pet_id: string
          written_by: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          note: string
          pet_id: string
          written_by: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          note?: string
          pet_id?: string
          written_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_grooming_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "grooming_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_grooming_notes_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          active: boolean
          allergies: string | null
          assessed_by: string | null
          assessment_date: string | null
          assessment_notes: string | null
          assessment_status: Database["public"]["Enums"]["assessment_status"]
          behaviour_notes: string | null
          behavioural_notes: string | null
          breed: string | null
          camera_preferred: boolean
          coat_type: Database["public"]["Enums"]["coat_type"] | null
          colour: string | null
          created_at: string
          date_of_birth: string | null
          feeding_instructions: string | null
          feeding_notes: string | null
          gender: Database["public"]["Enums"]["pet_gender"] | null
          grooming_notes: string | null
          id: string
          medical_conditions: string | null
          medical_notes: string | null
          medication_notes: string | null
          medications: string | null
          microchip_number: string | null
          name: string
          other_notes: string | null
          owner_id: string
          photo_url: string | null
          restriction_reason: string | null
          restriction_set_at: string | null
          restriction_set_by: string | null
          room_restriction: Database["public"]["Enums"]["room_restriction_type"]
          size: Database["public"]["Enums"]["pet_size"] | null
          source_external_id: string | null
          spayed_neutered: boolean | null
          special_alerts: Json | null
          species: Database["public"]["Enums"]["species"]
          status: string | null
          updated_at: string
          vaccicheck_cav_value: number | null
          vaccicheck_cdv_value: number | null
          vaccicheck_cpv_value: number | null
          vaccicheck_distemper_tier: string | null
          vaccicheck_hepatitis_tier: string | null
          vaccicheck_immunity_rating: string | null
          vaccicheck_parvovirus_tier: string | null
          vaccicheck_performed_at: string | null
          vaccicheck_recommendations: string | null
          vaccicheck_report_url: string | null
          vaccicheck_result_mode: string | null
          vaccicheck_test_date: string | null
          vet_name: string | null
          vet_phone: string | null
          weight_kg: number | null
        }
        Insert: {
          active?: boolean
          allergies?: string | null
          assessed_by?: string | null
          assessment_date?: string | null
          assessment_notes?: string | null
          assessment_status?: Database["public"]["Enums"]["assessment_status"]
          behaviour_notes?: string | null
          behavioural_notes?: string | null
          breed?: string | null
          camera_preferred?: boolean
          coat_type?: Database["public"]["Enums"]["coat_type"] | null
          colour?: string | null
          created_at?: string
          date_of_birth?: string | null
          feeding_instructions?: string | null
          feeding_notes?: string | null
          gender?: Database["public"]["Enums"]["pet_gender"] | null
          grooming_notes?: string | null
          id?: string
          medical_conditions?: string | null
          medical_notes?: string | null
          medication_notes?: string | null
          medications?: string | null
          microchip_number?: string | null
          name: string
          other_notes?: string | null
          owner_id: string
          photo_url?: string | null
          restriction_reason?: string | null
          restriction_set_at?: string | null
          restriction_set_by?: string | null
          room_restriction?: Database["public"]["Enums"]["room_restriction_type"]
          size?: Database["public"]["Enums"]["pet_size"] | null
          source_external_id?: string | null
          spayed_neutered?: boolean | null
          special_alerts?: Json | null
          species?: Database["public"]["Enums"]["species"]
          status?: string | null
          updated_at?: string
          vaccicheck_cav_value?: number | null
          vaccicheck_cdv_value?: number | null
          vaccicheck_cpv_value?: number | null
          vaccicheck_distemper_tier?: string | null
          vaccicheck_hepatitis_tier?: string | null
          vaccicheck_immunity_rating?: string | null
          vaccicheck_parvovirus_tier?: string | null
          vaccicheck_performed_at?: string | null
          vaccicheck_recommendations?: string | null
          vaccicheck_report_url?: string | null
          vaccicheck_result_mode?: string | null
          vaccicheck_test_date?: string | null
          vet_name?: string | null
          vet_phone?: string | null
          weight_kg?: number | null
        }
        Update: {
          active?: boolean
          allergies?: string | null
          assessed_by?: string | null
          assessment_date?: string | null
          assessment_notes?: string | null
          assessment_status?: Database["public"]["Enums"]["assessment_status"]
          behaviour_notes?: string | null
          behavioural_notes?: string | null
          breed?: string | null
          camera_preferred?: boolean
          coat_type?: Database["public"]["Enums"]["coat_type"] | null
          colour?: string | null
          created_at?: string
          date_of_birth?: string | null
          feeding_instructions?: string | null
          feeding_notes?: string | null
          gender?: Database["public"]["Enums"]["pet_gender"] | null
          grooming_notes?: string | null
          id?: string
          medical_conditions?: string | null
          medical_notes?: string | null
          medication_notes?: string | null
          medications?: string | null
          microchip_number?: string | null
          name?: string
          other_notes?: string | null
          owner_id?: string
          photo_url?: string | null
          restriction_reason?: string | null
          restriction_set_at?: string | null
          restriction_set_by?: string | null
          room_restriction?: Database["public"]["Enums"]["room_restriction_type"]
          size?: Database["public"]["Enums"]["pet_size"] | null
          source_external_id?: string | null
          spayed_neutered?: boolean | null
          special_alerts?: Json | null
          species?: Database["public"]["Enums"]["species"]
          status?: string | null
          updated_at?: string
          vaccicheck_cav_value?: number | null
          vaccicheck_cdv_value?: number | null
          vaccicheck_cpv_value?: number | null
          vaccicheck_distemper_tier?: string | null
          vaccicheck_hepatitis_tier?: string | null
          vaccicheck_immunity_rating?: string | null
          vaccicheck_parvovirus_tier?: string | null
          vaccicheck_performed_at?: string | null
          vaccicheck_recommendations?: string | null
          vaccicheck_report_url?: string | null
          vaccicheck_result_mode?: string | null
          vaccicheck_test_date?: string | null
          vet_name?: string | null
          vet_phone?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_groups: {
        Row: {
          created_at: string
          id: string
          invoice_id: string | null
          multi_pet_discount_applied: number
          owner_id: string
          package_def_id: string
          pet_count: number
          staff_label: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          multi_pet_discount_applied?: number
          owner_id: string
          package_def_id: string
          pet_count: number
          staff_label?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          multi_pet_discount_applied?: number
          owner_id?: string
          package_def_id?: string
          pet_count?: number
          staff_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_groups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_groups_package_def_id_fkey"
            columns: ["package_def_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      room_types: {
        Row: {
          created_at: string
          is_builtin: boolean
          label: string
          slug: string
        }
        Insert: {
          created_at?: string
          is_builtin?: boolean
          label: string
          slug: string
        }
        Update: {
          created_at?: string
          is_builtin?: boolean
          label?: string
          slug?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          cam_host: string | null
          cam_id: string | null
          cam_number: string | null
          cam_password: string | null
          cam_username: string | null
          camera_recording: boolean | null
          capacity_type: Database["public"]["Enums"]["capacity_type"]
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          label_color: string | null
          max_pets: number
          name: string
          nightly_rate: number | null
          notes: string | null
          pet_type: string | null
          room_number: string
          room_type: Database["public"]["Enums"]["room_type"]
          size_class: Database["public"]["Enums"]["room_size_class"] | null
          source_external_id: string | null
          street_name: string | null
          wing: Database["public"]["Enums"]["room_wing"]
          zone: string | null
        }
        Insert: {
          cam_host?: string | null
          cam_id?: string | null
          cam_number?: string | null
          cam_password?: string | null
          cam_username?: string | null
          camera_recording?: boolean | null
          capacity_type?: Database["public"]["Enums"]["capacity_type"]
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          label_color?: string | null
          max_pets?: number
          name?: string
          nightly_rate?: number | null
          notes?: string | null
          pet_type?: string | null
          room_number: string
          room_type: Database["public"]["Enums"]["room_type"]
          size_class?: Database["public"]["Enums"]["room_size_class"] | null
          source_external_id?: string | null
          street_name?: string | null
          wing: Database["public"]["Enums"]["room_wing"]
          zone?: string | null
        }
        Update: {
          cam_host?: string | null
          cam_id?: string | null
          cam_number?: string | null
          cam_password?: string | null
          cam_username?: string | null
          camera_recording?: boolean | null
          capacity_type?: Database["public"]["Enums"]["capacity_type"]
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          label_color?: string | null
          max_pets?: number
          name?: string
          nightly_rate?: number | null
          notes?: string | null
          pet_type?: string | null
          room_number?: string
          room_type?: Database["public"]["Enums"]["room_type"]
          size_class?: Database["public"]["Enums"]["room_size_class"] | null
          source_external_id?: string | null
          street_name?: string | null
          wing?: Database["public"]["Enums"]["room_wing"]
          zone?: string | null
        }
        Relationships: []
      }
      service_code_meta: {
        Row: {
          applicable_species: Database["public"]["Enums"]["species"][]
          description: string | null
          display_name: string
          is_active: boolean
          service_code: Database["public"]["Enums"]["service_code"]
          unit: Database["public"]["Enums"]["service_unit"]
          updated_at: string
          updated_by: string | null
          vat_included: boolean
        }
        Insert: {
          applicable_species: Database["public"]["Enums"]["species"][]
          description?: string | null
          display_name: string
          is_active?: boolean
          service_code: Database["public"]["Enums"]["service_code"]
          unit: Database["public"]["Enums"]["service_unit"]
          updated_at?: string
          updated_by?: string | null
          vat_included?: boolean
        }
        Update: {
          applicable_species?: Database["public"]["Enums"]["species"][]
          description?: string | null
          display_name?: string
          is_active?: boolean
          service_code?: Database["public"]["Enums"]["service_code"]
          unit?: Database["public"]["Enums"]["service_unit"]
          updated_at?: string
          updated_by?: string | null
          vat_included?: boolean
        }
        Relationships: []
      }
      service_credits: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          is_bonus: boolean
          pet_id: string
          purchase_group_id: string | null
          redemption_group_id: string | null
          service_code: Database["public"]["Enums"]["service_code"]
          source_ref_id: string | null
          source_type: string
          status: string
          units_consumed: number
          units_total: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          is_bonus?: boolean
          pet_id: string
          purchase_group_id?: string | null
          redemption_group_id?: string | null
          service_code: Database["public"]["Enums"]["service_code"]
          source_ref_id?: string | null
          source_type: string
          status?: string
          units_consumed?: number
          units_total: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          is_bonus?: boolean
          pet_id?: string
          purchase_group_id?: string | null
          redemption_group_id?: string | null
          service_code?: Database["public"]["Enums"]["service_code"]
          source_ref_id?: string | null
          source_type?: string
          status?: string
          units_consumed?: number
          units_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_credits_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_credits_purchase_group_id_fkey"
            columns: ["purchase_group_id"]
            isOneToOne: false
            referencedRelation: "purchase_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      service_rates: {
        Row: {
          amount_aed: number
          coat_type: Database["public"]["Enums"]["coat_type"] | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean
          notes: string | null
          pet_size: Database["public"]["Enums"]["pet_size"] | null
          season: Database["public"]["Enums"]["rate_season"] | null
          service_code: Database["public"]["Enums"]["service_code"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_aed: number
          coat_type?: Database["public"]["Enums"]["coat_type"] | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          pet_size?: Database["public"]["Enums"]["pet_size"] | null
          season?: Database["public"]["Enums"]["rate_season"] | null
          service_code: Database["public"]["Enums"]["service_code"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_aed?: number
          coat_type?: Database["public"]["Enums"]["coat_type"] | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          pet_size?: Database["public"]["Enums"]["pet_size"] | null
          season?: Database["public"]["Enums"]["rate_season"] | null
          service_code?: Database["public"]["Enums"]["service_code"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_rates_service_code_fkey"
            columns: ["service_code"]
            isOneToOne: false
            referencedRelation: "service_code_meta"
            referencedColumns: ["service_code"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          phone?: string | null
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: []
      }
      staff_sessions: {
        Row: {
          created_at: string
          history: Json
          id: string
          staff_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          history?: Json
          id?: string
          staff_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          history?: Json
          id?: string
          staff_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      stay_medications: {
        Row: {
          booking_id: string
          created_at: string
          dosage: string | null
          frequency: string | null
          id: string
          medication_name: string
          notes: string | null
          pet_id: string
          timing: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          dosage?: string | null
          frequency?: string | null
          id?: string
          medication_name: string
          notes?: string | null
          pet_id: string
          timing?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          dosage?: string | null
          frequency?: string | null
          id?: string
          medication_name?: string
          notes?: string | null
          pet_id?: string
          timing?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stay_medications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stay_medications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "woof_v_booking_required_class"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "stay_medications_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      system_context: {
        Row: {
          content: string
          key: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          content: string
          key: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          key?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_context_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_prompts: {
        Row: {
          created_at: string
          fallback_strings: Json
          id: string
          is_active: boolean
          rules_markdown: string | null
          system_prompt_template: string
          tenant_id: string
          version: number
        }
        Insert: {
          created_at?: string
          fallback_strings?: Json
          id?: string
          is_active?: boolean
          rules_markdown?: string | null
          system_prompt_template: string
          tenant_id: string
          version?: number
        }
        Update: {
          created_at?: string
          fallback_strings?: Json
          id?: string
          is_active?: boolean
          rules_markdown?: string | null
          system_prompt_template?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_prompts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_tools: {
        Row: {
          config: Json
          created_at: string
          description_override: string | null
          enabled: boolean
          id: string
          permissions: string
          schema_override: Json | null
          tenant_id: string
          tool_name: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description_override?: string | null
          enabled?: boolean
          id?: string
          permissions?: string
          schema_override?: Json | null
          tenant_id: string
          tool_name: string
        }
        Update: {
          config?: Json
          created_at?: string
          description_override?: string | null
          enabled?: boolean
          id?: string
          permissions?: string
          schema_override?: Json | null
          tenant_id?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_tools_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          booking_ref_prefix: string | null
          created_at: string
          daily_token_cap: number | null
          default_mode: string
          display_name: string
          escalation_policy: Json
          id: string
          language: string
          metadata: Json
          slug: string
          staff_group_id: string | null
          timezone: string
          updated_at: string
          wa_session_client_id: string | null
        }
        Insert: {
          booking_ref_prefix?: string | null
          created_at?: string
          daily_token_cap?: number | null
          default_mode?: string
          display_name: string
          escalation_policy?: Json
          id?: string
          language?: string
          metadata?: Json
          slug: string
          staff_group_id?: string | null
          timezone?: string
          updated_at?: string
          wa_session_client_id?: string | null
        }
        Update: {
          booking_ref_prefix?: string | null
          created_at?: string
          daily_token_cap?: number | null
          default_mode?: string
          display_name?: string
          escalation_policy?: Json
          id?: string
          language?: string
          metadata?: Json
          slug?: string
          staff_group_id?: string | null
          timezone?: string
          updated_at?: string
          wa_session_client_id?: string | null
        }
        Relationships: []
      }
      vaccinations: {
        Row: {
          administered_date: string | null
          created_at: string
          document_url: string | null
          expiry_date: string
          id: string
          pet_id: string
          updated_at: string
          vaccine_name: string
        }
        Insert: {
          administered_date?: string | null
          created_at?: string
          document_url?: string | null
          expiry_date: string
          id?: string
          pet_id: string
          updated_at?: string
          vaccine_name: string
        }
        Update: {
          administered_date?: string | null
          created_at?: string
          document_url?: string | null
          expiry_date?: string
          id?: string
          pet_id?: string
          updated_at?: string
          vaccine_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccinations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      vet_clinics: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      waiting_list: {
        Row: {
          created_at: string
          has_wallet_balance: boolean
          id: string
          notes: string | null
          owner_id: string | null
          owner_name_raw: string | null
          pet_id: string | null
          pet_name_raw: string | null
          requested_check_in: string
          requested_check_out: string
          room_type_requested: Database["public"]["Enums"]["room_type"] | null
          status: string
          transport_needed: boolean
        }
        Insert: {
          created_at?: string
          has_wallet_balance?: boolean
          id?: string
          notes?: string | null
          owner_id?: string | null
          owner_name_raw?: string | null
          pet_id?: string | null
          pet_name_raw?: string | null
          requested_check_in: string
          requested_check_out: string
          room_type_requested?: Database["public"]["Enums"]["room_type"] | null
          status?: string
          transport_needed?: boolean
        }
        Update: {
          created_at?: string
          has_wallet_balance?: boolean
          id?: string
          notes?: string | null
          owner_id?: string | null
          owner_name_raw?: string | null
          pet_id?: string | null
          pet_name_raw?: string | null
          requested_check_in?: string
          requested_check_out?: string
          room_type_requested?: Database["public"]["Enums"]["room_type"] | null
          status?: string
          transport_needed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "waiting_list_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiting_list_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_topup_receipts: {
        Row: {
          amount: number
          id: string
          issued_at: string
          issued_by: string
          notes: string | null
          owner_id: string
          receipt_number: string | null
          wallet_transaction_id: string
        }
        Insert: {
          amount: number
          id?: string
          issued_at?: string
          issued_by: string
          notes?: string | null
          owner_id: string
          receipt_number?: string | null
          wallet_transaction_id: string
        }
        Update: {
          amount?: number
          id?: string
          issued_at?: string
          issued_by?: string
          notes?: string | null
          owner_id?: string
          receipt_number?: string | null
          wallet_transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_topup_receipts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_topup_receipts_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_topup_requests: {
        Row: {
          amount_requested: number
          id: string
          notes: string | null
          owner_id: string
          received_at: string | null
          reminder_sent_at: string | null
          requested_at: string | null
          requested_by: string
          status: string
        }
        Insert: {
          amount_requested: number
          id?: string
          notes?: string | null
          owner_id: string
          received_at?: string | null
          reminder_sent_at?: string | null
          requested_at?: string | null
          requested_by?: string
          status?: string
        }
        Update: {
          amount_requested?: number
          id?: string
          notes?: string | null
          owner_id?: string
          received_at?: string | null
          reminder_sent_at?: string | null
          requested_at?: string | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_topup_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          id: string
          invoice_id: string | null
          notes: string | null
          owner_id: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          performed_by: string | null
          reference_id: string | null
          reference_type: string | null
          service_type: string | null
          staff_id: string | null
          transaction_type: Database["public"]["Enums"]["transaction_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          owner_id: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          service_type?: string | null
          staff_id?: string | null
          transaction_type: Database["public"]["Enums"]["transaction_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          owner_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          service_type?: string | null
          staff_id?: string | null
          transaction_type?: Database["public"]["Enums"]["transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions_fix_emma_procter_20260606: {
        Row: {
          amount: number
          archived_at: string
          created_at: string
          invoice_id: string | null
          payment_method: string | null
          transaction_id: string
          transaction_type: string
        }
        Insert: {
          amount: number
          archived_at?: string
          created_at: string
          invoice_id?: string | null
          payment_method?: string | null
          transaction_id: string
          transaction_type: string
        }
        Update: {
          amount?: number
          archived_at?: string
          created_at?: string
          invoice_id?: string | null
          payment_method?: string | null
          transaction_id?: string
          transaction_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      agent_capability_gaps: {
        Row: {
          blocked_reason: string | null
          chat_id: string | null
          day: string | null
          gap_type: string | null
          message_in: string | null
          started_at: string | null
          tool_trace: string | null
        }
        Insert: {
          blocked_reason?: string | null
          chat_id?: string | null
          day?: never
          gap_type?: never
          message_in?: string | null
          started_at?: string | null
          tool_trace?: string | null
        }
        Update: {
          blocked_reason?: string | null
          chat_id?: string | null
          day?: never
          gap_type?: never
          message_in?: string | null
          started_at?: string | null
          tool_trace?: string | null
        }
        Relationships: []
      }
      agent_open_capability_requests: {
        Row: {
          attempted_capability: string | null
          attempted_kind: string | null
          first_seen: string | null
          hits: number | null
          last_seen: string | null
          sample_message: string | null
        }
        Relationships: []
      }
      woof_v_booking_required_class: {
        Row: {
          booking_id: string | null
          has_restriction: boolean | null
          pet_count: number | null
          required_class: Database["public"]["Enums"]["room_size_class"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      _agent_owner_for_phone: { Args: { p_phone: string }; Returns: string }
      agent_add_booking_addon: {
        Args: { p_addon: Json; p_booking_id: string; p_phone: string }
        Returns: Json
      }
      agent_book_grooming: {
        Args: { p_grooming: Json; p_pet_id: string; p_phone: string }
        Returns: Json
      }
      agent_check_room_availability: {
        Args: { p_check_in: string; p_check_out: string; p_room_id: string }
        Returns: Json
      }
      agent_create_daycare_session: {
        Args: { p_pet_id: string; p_phone: string; p_session: Json }
        Returns: Json
      }
      agent_create_owner: {
        Args: { p_phone: string; p_profile: Json }
        Returns: Json
      }
      agent_create_pet: {
        Args: { p_pet: Json; p_phone: string }
        Returns: Json
      }
      agent_introspect: { Args: never; Returns: Json }
      agent_record_vaccination: {
        Args: { p_pet_id: string; p_phone: string; p_vacc: Json }
        Returns: Json
      }
      agent_record_wallet_transaction: {
        Args: { p_phone: string; p_txn: Json }
        Returns: Json
      }
      agent_update_pet: {
        Args: { p_pet_id: string; p_phone: string; p_updates: Json }
        Returns: Json
      }
      apply_double_occupancy_discount: {
        Args: { p_booking_id: string }
        Returns: string
      }
      boarding_kennel_occupancy_counts: {
        Args: { p_as_of: string }
        Returns: Json
      }
      calculate_cancellation_refund:
        | {
            Args: {
              p_invoice_id: string
              p_owner_id: string
              p_service_start: string
            }
            Returns: {
              hours_notice: number
              override_active: boolean
              policy_label: string
              refund_aed: number
              refund_pct: number
            }[]
          }
        | {
            Args: {
              p_invoice_id: string
              p_owner_id: string
              p_service_start: string
            }
            Returns: {
              hours_notice: number
              override_active: boolean
              policy_label: string
              refund_aed: number
              refund_pct: number
            }[]
          }
      calculate_double_occupancy_discount: {
        Args: { p_booking_id: string }
        Returns: number
      }
      collect_account_payment: {
        Args: {
          p_external_amount: number
          p_external_method: Database["public"]["Enums"]["payment_method"]
          p_owner_id: string
          p_performed_by: string
          p_wallet_amount: number
        }
        Returns: Json
      }
      consolidate_owner_invoices: {
        Args: {
          p_invoice_ids: string[]
          p_owner_id: string
          p_performed_by: string
        }
        Returns: string
      }
      consume_service_credit: {
        Args: {
          p_allow_expired?: boolean
          p_consumed_for_ref_id?: string
          p_consumed_for_ref_type?: string
          p_credit_id: string
          p_units?: number
        }
        Returns: {
          credit_id: string
          new_status: string
          units_remaining: number
        }[]
      }
      create_assessment_booking: {
        Args: {
          p_notes?: string
          p_pet_id: string
          p_session_date: string
          p_session_start_time: string
          p_staff_id?: string
        }
        Returns: {
          amount_aed: number
          booking_id: string
          invoice_id: string
        }[]
      }
      create_room_type: { Args: { p_label: string }; Returns: string }
      credit_wallet_topup: {
        Args: {
          p_amount: number
          p_notes?: string
          p_owner_id: string
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_performed_by?: string
          p_staff_id?: string
          p_transaction_type?: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: Json
      }
      deactivate_peak_period: { Args: { p_id: string }; Returns: undefined }
      do_legacy_import_atomic: { Args: { p_payload: Json }; Returns: Json }
      flag_overdue_invoices: { Args: never; Returns: number }
      generate_booking_ref: { Args: never; Returns: string }
      get_client_payment_summary: {
        Args: { p_owner_id: string }
        Returns: Json
      }
      get_dashboard_metrics: { Args: { p_as_of?: string }; Returns: Json }
      get_owners_with_collectable_debt: {
        Args: never
        Returns: {
          due_now: number
          in_progress: number
          invoice_count: number
          last_reminder_at: string
          max_days_overdue: number
          oldest_due_date: string
          overdue_now: number
          owner_id: string
          owner_name: string
          phone: string
          total_balance: number
          wallet_credit: number
        }[]
      }
      get_statement_of_account: {
        Args: { p_owner_id: string }
        Returns: {
          created_at: string
          days_overdue: number
          due_date: string
          invoice_id: string
          invoice_number: string
          service_type: string
          status: string
          total: number
        }[]
      }
      insert_invoice_payment: {
        Args: {
          p_amount: number
          p_closing_balance: number
          p_confirm_duplicate?: boolean
          p_invoice_id: string
          p_notes?: string | null
          p_opening_balance: number
          p_owner_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_recorded_by: string
          p_wallet_transaction_id?: string | null
        }
        Returns: string
      }
      is_boarding_import_placeholder_room: {
        Args: { p_room: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: boolean
      }
      is_import_placeholder_room_id: {
        Args: { p_room_id: string }
        Returns: boolean
      }
      is_kennel_occupancy_room: {
        Args: { p_room: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: boolean
      }
      is_peak_date: { Args: { p_date: string }; Returns: boolean }
      issue_custom_daycare_package:
        | {
            Args: {
              p_amount_aed?: number
              p_label?: string
              p_owner_id: string
              p_payment_method?: Database["public"]["Enums"]["payment_method"]
              p_pet_ids: string[]
              p_service_code?: Database["public"]["Enums"]["service_code"]
              p_units: number
              p_validity_months?: number
            }
            Returns: {
              credits_granted: number
              discount_applied_aed: number
              invoice_id: string
              purchase_group_id: string
              total_amount_aed: number
            }[]
          }
        | {
            Args: {
              p_amount_aed?: number
              p_issue_date?: string
              p_label?: string
              p_owner_id: string
              p_payment_method?: Database["public"]["Enums"]["payment_method"]
              p_pet_ids: string[]
              p_service_code?: Database["public"]["Enums"]["service_code"]
              p_units: number
              p_validity_months?: number
            }
            Returns: {
              credits_granted: number
              discount_applied_aed: number
              invoice_id: string
              purchase_group_id: string
              total_amount_aed: number
            }[]
          }
        | {
            Args: {
              p_amount_aed?: number
              p_apply_multi_pet_discount?: boolean
              p_issue_date?: string
              p_label?: string
              p_line_items?: Json
              p_owner_id: string
              p_payment_method?: Database["public"]["Enums"]["payment_method"]
              p_pet_ids: string[]
              p_service_code?: Database["public"]["Enums"]["service_code"]
              p_units: number
              p_validity_months?: number
            }
            Returns: {
              credits_granted: number
              discount_applied_aed: number
              invoice_id: string
              purchase_group_id: string
              total_amount_aed: number
            }[]
          }
      list_active_credits_for_pet: {
        Args: {
          p_pet_id: string
          p_service_code?: Database["public"]["Enums"]["service_code"]
        }
        Returns: {
          credit_id: string
          expires_at: string
          is_bonus: boolean
          package_name: string
          service_code: Database["public"]["Enums"]["service_code"]
          source_type: string
          units_remaining: number
        }[]
      }
      move_boarding_room: {
        Args: {
          p_booking_id: string
          p_effective_date: string
          p_moved_by?: string
          p_override_do_not_move?: boolean
          p_reason?: string
          p_target_room_id: string
        }
        Returns: Json
      }
      process_wallet_payment: {
        Args: { p_invoice_id: string; p_performed_by?: string }
        Returns: Json
      }
      purchase_package: {
        Args: {
          p_apply_multi_pet_discount?: boolean
          p_issue_date?: string
          p_owner_id: string
          p_package_code: string
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_pet_ids: string[]
        }
        Returns: {
          credits_granted: number
          discount_applied_aed: number
          invoice_id: string
          purchase_group_id: string
          total_amount_aed: number
        }[]
      }
      resolve_woof_service_rate: {
        Args: {
          p_booking_date?: string
          p_coat_type?: Database["public"]["Enums"]["coat_type"]
          p_pet_size?: Database["public"]["Enums"]["pet_size"]
          p_service_code: Database["public"]["Enums"]["service_code"]
        }
        Returns: {
          amount_aed: number
          is_peak: boolean
          matched_season: Database["public"]["Enums"]["rate_season"]
          notes: string
          rate_id: string
          service_code: Database["public"]["Enums"]["service_code"]
          unit: Database["public"]["Enums"]["service_unit"]
        }[]
      }
      restore_service_credit: {
        Args: { p_credit_id: string; p_units?: number }
        Returns: {
          credit_id: string
          new_status: string
          units_remaining: number
        }[]
      }
      revoke_daycare_package_credit: {
        Args: { p_credit_id: string; p_reason?: string; p_staff?: string }
        Returns: {
          credit_id: string
          invoice_voided: boolean
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      void_invoice: {
        Args: { p_invoice: string; p_reason: string; p_staff: string }
        Returns: number
      }
      upsert_peak_period: {
        Args: {
          p_end_date?: string
          p_id?: string
          p_label?: string
          p_notes?: string
          p_start_date?: string
        }
        Returns: string
      }
      woof_assignment_covers_night: {
        Args: { p_end: string; p_night: string; p_start: string }
        Returns: boolean
      }
      woof_backfill_room_size_class: { Args: never; Returns: undefined }
      woof_boarding_night_capacity: {
        Args: { p_date: string }
        Returns: {
          assigned: number
          feasible: boolean
          large_free: number
          large_required: number
          large_rooms: number
          reason: string
          standard_rooms: number
          total_bookings: number
          total_free: number
          unassigned: number
        }[]
      }
      woof_boarding_range_feasibility: {
        Args: {
          p_adding_class?: Database["public"]["Enums"]["room_size_class"]
          p_check_in: string
          p_check_out: string
        }
        Returns: {
          feasible: boolean
          large_free: number
          reason: string
          stay_date: string
          total_free: number
        }[]
      }
      woof_booking_night_overlaps_assignment: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_seg_end: string
          p_seg_start: string
        }
        Returns: boolean
      }
      woof_dog_room_load: { Args: { p_size: string }; Returns: number }
      woof_grooming_backlog: {
        Args: { p_date: string }
        Returns: {
          appt_id: string
          booking_ref: string
          dog_name: string
          duration_minutes: number
          owner_id: string
          pet_id: string
          pet_size: string
          service: Database["public"]["Enums"]["grooming_service"]
          source_booking_id: string
        }[]
      }
      woof_grooming_day_capacity: {
        Args: { p_date: string; p_day_end?: string; p_day_start?: string }
        Returns: {
          committed_minutes: number
          feasible: boolean
          floating_minutes: number
          free_minutes: number
          pinned_minutes: number
          stations: number
          total_minutes: number
          window_minutes: number
        }[]
      }
      woof_grooming_default_minutes: {
        Args: {
          p_service: Database["public"]["Enums"]["grooming_service"]
          p_size: string
        }
        Returns: number
      }
      woof_grooming_station_load: {
        Args: { p_date: string; p_day_end?: string; p_day_start?: string }
        Returns: {
          free_minutes: number
          station_id: string
          station_name: string
          used_minutes: number
          window_minutes: number
        }[]
      }
      woof_is_boarding_capacity_room: {
        Args: { p_room: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: boolean
      }
      woof_required_class: {
        Args: { p_force_large?: boolean; p_sizes: string[] }
        Returns: Database["public"]["Enums"]["room_size_class"]
      }
      woof_suggest_boarding_room: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_required_class: Database["public"]["Enums"]["room_size_class"]
        }
        Returns: {
          is_overflow: boolean
          room_id: string
          room_label: string
          size_class: Database["public"]["Enums"]["room_size_class"]
        }[]
      }
      woof_unassigned_boarding: {
        Args: { p_date: string }
        Returns: {
          arrival: string
          booking_id: string
          booking_ref: string
          check_in_date: string
          check_out_date: string
          do_not_move: boolean
          dog_names: string
          has_restriction: boolean
          owner_id: string
          owner_name: string
          pet_count: number
          required_class: Database["public"]["Enums"]["room_size_class"]
        }[]
      }
      woof_validate_boarding_assignment: {
        Args: {
          p_booking_id: string
          p_end: string
          p_room_id: string
          p_start: string
        }
        Returns: Json
      }
      woof_validate_grooming_appt: {
        Args: {
          p_appt_id?: string
          p_date: string
          p_day_end?: string
          p_day_start?: string
          p_duration: number
          p_start: string
          p_station_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      addon_type:
        | "transport_dubai"
        | "transport_abudhabi"
        | "grooming_full"
        | "grooming_bath"
        | "grooming_nail"
        | "grooming_deshedding"
        | "grooming_brushing"
        | "other"
      assessment_status: "not_assessed" | "passed" | "failed" | "scheduled"
      boarding_type: "boarding_only" | "board_and_train"
      booking_status:
        | "enquiry"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "no_show"
        | "draft"
      booking_type:
        | "boarding"
        | "daycare"
        | "park"
        | "grooming"
        | "transport"
        | "training"
        | "assessment"
      capacity_type: "single" | "twin" | "twin_plus" | "multiple"
      coat_type: "short" | "mid_length" | "long"
      grooming_package:
        | "grande"
        | "bijoux"
        | "deshedding_long"
        | "deshedding_smooth"
        | "bath_blow"
      grooming_service:
        | "full_groom"
        | "full_bath"
        | "splash"
        | "nail_clip"
        | "deshedding"
        | "brushing"
        | "pawdicure"
        | "tidy"
        | "gland_expression"
      invoice_status:
        | "draft"
        | "issued"
        | "paid"
        | "partially_paid"
        | "cancelled"
        | "finalised"
        | "outstanding"
        | "overdue"
        | "voided"
        | "consolidated"
      payment_method:
        | "wallet"
        | "card"
        | "cash"
        | "bank_transfer"
        | "payment_link"
      pet_gender: "male" | "female"
      pet_size: "small" | "medium" | "large"
      rate_season: "peak" | "off_peak"
      room_restriction_type: "none" | "large_only"
      room_size_class: "standard" | "large"
      room_type:
        | "presidential_super"
        | "presidential_standard"
        | "royal_suite_double"
        | "royal_suite_single"
        | "double_royal"
        | "single_royal"
        | "family_room"
        | "royal_annex"
        | "cattery_super_presidential"
        | "cattery_presidential"
        | "cattery_deluxe"
        | "park_lane"
        | "pall_mall"
        | "kennels"
        | "presidential_single"
        | "presidential_double"
        | "deluxe"
        | "standard"
        | "standard_glass"
        | "lg_deluxe"
        | "lg_royal"
        | "lg_standard"
        | "lg_presidential"
        | "lg_presidential_double"
        | "lg_royal_double"
        | "lg_standard_luxury"
        | "lg_resting_nook"
        | "standard_deluxe"
        | "kitchen"
        | "royal"
      room_wing:
        | "oxford"
        | "piccadilly"
        | "park_lane"
        | "fleet"
        | "back_kennels"
        | "cattery"
        | "grooming_upstairs"
        | "bond_rooms"
        | "dluxe"
        | "standard_room"
        | "Royal Suite"
        | "bond_suite"
        | "royal_annex"
        | "royal_suite"
        | "pall_mall"
        | "little_gems"
        | "standard_suite"
        | "grooming_room"
        | "training_room"
        | "deluxe_annex"
        | "deluxe_suite"
        | "lg_resting_nook"
        | "lg_grooming_room"
        | "furrari_lounge"
        | "kitchen"
        | "import_placeholder"
      service_code:
        | "boarding_night"
        | "daycare_full_day"
        | "daycare_hourly"
        | "grooming_full_service"
        | "cat_grooming_full_no_bath"
        | "cat_grooming_full_with_bath"
        | "grooming_bath_brush_tidy"
        | "grooming_nail_ear_teeth"
        | "cat_grooming_nail_ear"
        | "grooming_hair_no_more"
        | "cat_grooming_hair_no_more"
        | "grooming_splash"
        | "cat_grooming_splash"
        | "addon_nails"
        | "addon_glands"
        | "grooming_gland_expression"
        | "addon_dematting"
        | "addon_teeth_cleaning"
        | "addon_flea_tick_bath"
        | "addon_specialised_shampoo"
        | "treadmill_daycare_addon"
        | "treadmill_hourly_addon"
        | "assessment_with_first_hour"
        | "daycare_half_day"
        | "grooming_tidy"
        | "board_and_train_night"
      service_unit:
        | "per_night"
        | "per_day"
        | "per_hour"
        | "per_half_hour"
        | "per_session"
        | "each"
      species: "dog" | "cat" | "other"
      staff_role:
        | "booking_coordinator"
        | "management"
        | "groomer"
        | "kennel_staff"
        | "night_staff"
        | "admin"
      transaction_type:
        | "top_up"
        | "deduction"
        | "refund"
        | "membership_fee"
        | "adjustment"
        | "card_payment"
        | "cash_payment"
        | "manual_topup"
        | "bank_transfer_payment"
        | "payment_link_payment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      addon_type: [
        "transport_dubai",
        "transport_abudhabi",
        "grooming_full",
        "grooming_bath",
        "grooming_nail",
        "grooming_deshedding",
        "grooming_brushing",
        "other",
      ],
      assessment_status: ["not_assessed", "passed", "failed", "scheduled"],
      boarding_type: ["boarding_only", "board_and_train"],
      booking_status: [
        "enquiry",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
        "draft",
      ],
      booking_type: [
        "boarding",
        "daycare",
        "park",
        "grooming",
        "transport",
        "training",
        "assessment",
      ],
      capacity_type: ["single", "twin", "twin_plus", "multiple"],
      coat_type: ["short", "mid_length", "long"],
      grooming_package: [
        "grande",
        "bijoux",
        "deshedding_long",
        "deshedding_smooth",
        "bath_blow",
      ],
      grooming_service: [
        "full_groom",
        "full_bath",
        "splash",
        "nail_clip",
        "deshedding",
        "brushing",
        "pawdicure",
        "tidy",
        "gland_expression",
      ],
      invoice_status: [
        "draft",
        "issued",
        "paid",
        "partially_paid",
        "cancelled",
        "finalised",
        "outstanding",
        "overdue",
        "voided",
        "consolidated",
      ],
      payment_method: [
        "wallet",
        "card",
        "cash",
        "bank_transfer",
        "payment_link",
      ],
      pet_gender: ["male", "female"],
      pet_size: ["small", "medium", "large"],
      rate_season: ["peak", "off_peak"],
      room_restriction_type: ["none", "large_only"],
      room_size_class: ["standard", "large"],
      room_type: [
        "presidential_super",
        "presidential_standard",
        "royal_suite_double",
        "royal_suite_single",
        "double_royal",
        "single_royal",
        "family_room",
        "royal_annex",
        "cattery_super_presidential",
        "cattery_presidential",
        "cattery_deluxe",
        "park_lane",
        "pall_mall",
        "kennels",
        "presidential_single",
        "presidential_double",
        "deluxe",
        "standard",
        "standard_glass",
        "lg_deluxe",
        "lg_royal",
        "lg_standard",
        "lg_presidential",
        "lg_presidential_double",
        "lg_royal_double",
        "lg_standard_luxury",
        "lg_resting_nook",
        "standard_deluxe",
        "kitchen",
        "royal",
      ],
      room_wing: [
        "oxford",
        "piccadilly",
        "park_lane",
        "fleet",
        "back_kennels",
        "cattery",
        "grooming_upstairs",
        "bond_rooms",
        "dluxe",
        "standard_room",
        "Royal Suite",
        "bond_suite",
        "royal_annex",
        "royal_suite",
        "pall_mall",
        "little_gems",
        "standard_suite",
        "grooming_room",
        "training_room",
        "deluxe_annex",
        "deluxe_suite",
        "lg_resting_nook",
        "lg_grooming_room",
        "furrari_lounge",
        "kitchen",
        "import_placeholder",
      ],
      service_code: [
        "boarding_night",
        "daycare_full_day",
        "daycare_hourly",
        "grooming_full_service",
        "cat_grooming_full_no_bath",
        "cat_grooming_full_with_bath",
        "grooming_bath_brush_tidy",
        "grooming_nail_ear_teeth",
        "cat_grooming_nail_ear",
        "grooming_hair_no_more",
        "cat_grooming_hair_no_more",
        "grooming_splash",
        "cat_grooming_splash",
        "addon_nails",
        "addon_glands",
        "grooming_gland_expression",
        "addon_dematting",
        "addon_teeth_cleaning",
        "addon_flea_tick_bath",
        "addon_specialised_shampoo",
        "treadmill_daycare_addon",
        "treadmill_hourly_addon",
        "assessment_with_first_hour",
        "daycare_half_day",
        "grooming_tidy",
        "board_and_train_night",
      ],
      service_unit: [
        "per_night",
        "per_day",
        "per_hour",
        "per_half_hour",
        "per_session",
        "each",
      ],
      species: ["dog", "cat", "other"],
      staff_role: [
        "booking_coordinator",
        "management",
        "groomer",
        "kennel_staff",
        "night_staff",
        "admin",
      ],
      transaction_type: [
        "top_up",
        "deduction",
        "refund",
        "membership_fee",
        "adjustment",
        "card_payment",
        "cash_payment",
        "manual_topup",
        "bank_transfer_payment",
        "payment_link_payment",
      ],
    },
  },
} as const
