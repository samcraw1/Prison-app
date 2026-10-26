import { z } from "zod";

export const familySignupSchema = z.object({
  facility: z.string().regex(/^[a-z0-9-]{2,40}$/),
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().regex(/^[0-9+()\-\s]{7,20}$/, "Enter a valid phone number"),
  password: z.string().min(8).max(100),
});

export const residentLoginSchema = z.object({
  facility: z.string().regex(/^[a-z0-9-]{2,40}$/),
  booking: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/),
  pin: z.string().regex(/^[0-9]{6,8}$/),
});

export const MAX_PIN_FAILURES = 5;
