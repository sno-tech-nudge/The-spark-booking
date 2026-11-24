export type Role = "admin" | "member" | "guest";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  organisation: string | null;
  avatar_url?: string | null;
  role: Role;
};

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthly_price: number;
  desk_days_included: number | null;
  room_hours_included: number;
  room_access: boolean;
  after_hours_access: boolean;
  assigned_seat: boolean;
  self_serve: boolean;
  sort: number;
};

export type Settings = {
  day_pass_price: number;
  half_day_price: number;
  hold_minutes: number;
  open_hour: number;
  close_hour: number;
  after_hours_open: number;
  after_hours_close: number;
  gst_rate: number;
  booking_window_days: number;
  busy_nudge_pct?: number;
};

export type Resource = {
  id: string;
  kind: "desk" | "room";
  category: "desk" | "lounge" | "meeting" | "phone_booth" | "podcast";
  name: string;
  zone: string | null;
  table_no: number | null;
  capacity: number;
  hourly_rate: number;
  members_only: boolean;
  uses_credits: boolean;
  min_hours: number;
  amenities: string[];
  assigned_membership: string | null;
  is_active: boolean;
  sort: number;
};

export type Part = "morning" | "afternoon" | "full";

export type Occupancy = {
  booking_id: string;
  resource_id: string;
  kind: "desk" | "room" | "block";
  part: Part | null;
  booking_date: string;
  start_at: string;
  end_at: string;
  status: "held" | "confirmed";
  hold_expires_at: string | null;
};

export type Booking = {
  id: string;
  resource_id: string;
  user_id: string;
  kind: "desk" | "room" | "block";
  part: Part | null;
  booking_date: string;
  slot: string;
  status: "held" | "confirmed" | "cancelled" | "expired";
  hold_expires_at: string | null;
  units: number;
  amount: number;
  billing: "included" | "overage" | "free" | "pending_payment" | "paid" | "refund_due" | "none";
  payment_ref: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  note: string | null;
  created_at: string;
  updated_at?: string;
};

export type Usage = {
  plan_id: string | null;
  plan_name: string | null;
  assigned_seat_id: string | null;
  desk_days_included: number | null;
  room_hours_included: number | null;
  desk_days_used: number;
  room_hours_used: number;
  overage_amount: number;
};
