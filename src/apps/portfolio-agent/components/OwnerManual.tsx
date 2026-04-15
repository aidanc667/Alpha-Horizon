'use client';

// ─── OwnerManual ──────────────────────────────────────────────────────────────
// Renders the synthesizer-generated Owner Manual: maintenance schedule,
// rebalancing triggers, tax calendar, and behavioural guardrails.

import React from 'react';
import type { OwnerManualSection } from '../types';

interface OwnerManualProps {
  sections: OwnerManualSection[];
}

export default function OwnerManual({ sections }: OwnerManualProps) {
  void sections;
  return null;
}
