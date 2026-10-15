import { createClient } from '@supabase/supabase-js';
import type { Command, CommandResult, Snapshot } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = url && key ? createClient(url, key, { auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }) : null;
export class CommandError extends Error {
    constructor(message: string, readonly retryable: boolean) { super(message); }
}
export async function snapshot(): Promise<Snapshot> {
    if (!supabase) throw new Error('Connect Orion to Supabase first.');
    const { data, error } = await supabase.rpc('orion_snapshot');
    if (error) throw new Error(error.message);
    if (!data?.profile || !Array.isArray(data.activities)) throw new Error('The server returned an invalid snapshot. Apply Orion’s migrations.');
    return data as Snapshot;
}
export async function sendCommand(command: Command): Promise<CommandResult> {
    if (!supabase) throw new Error('Connect Orion to Supabase first.');
    const { data, error, status } = await supabase.rpc('orion_command', { command_id: command.id, action: command.action, payload: command.payload });
    // A PostgreSQL rejection rolls the entire command back. Network/5xx outcomes
    // are uncertain and must retain the ID for an idempotent retry.
    if (error) throw new CommandError(error.message, status === 0 || status >= 500 || !error.code);
    return data as CommandResult;
}
