import { fromMetres, metricLabel } from './logic';
import type { Metric, Quest } from './types';

export function metricProgress(metric: Metric | 'checklist', progress: number, target: number, imperial: boolean) {
    if (metric === 'metres') {
        const format = (n: number) => Number(fromMetres(n, imperial).toFixed(3)).toLocaleString();
        return `${format(progress)} / ${format(target)} ${imperial ? 'mi' : 'km'}`;
    }
    return `${progress.toLocaleString()} / ${target.toLocaleString()} ${metric === 'checklist' ? 'tasks' : metricLabel[metric]}`;
}

export function dashboardQuestProgress(quest: Quest, imperial: boolean) {
    const objectives = quest.objectives;
    if (quest.timeline && objectives?.length) {
        const fraction = objectives.reduce((sum, o) => sum + Math.min(1, Math.max(0, o.progress / o.target)), 0) / objectives.length;
        const only = objectives.length === 1 ? objectives[0] : undefined;
        return { fraction, label: only ? metricProgress(only.metric, only.progress, only.target, imperial) : `${quest.progress} / ${quest.target} objectives · ${Math.floor(fraction * 100)}%` };
    }
    return { fraction: Math.min(1, Math.max(0, quest.progress / quest.target)), label: metricProgress(quest.metric, quest.progress, quest.target, imperial) };
}

export function remainingTime(deadline: string, now: number) {
    const minutes = Math.ceil((Date.parse(deadline) - now) / 60000);
    if (minutes <= 0) return 'Deadline reached';
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ${minutes % 60}m left` : `${Math.floor(hours / 24)}d ${hours % 24}h left`;
}
