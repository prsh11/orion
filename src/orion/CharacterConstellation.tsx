import GameIcon from './GameIcon';
import { useOrion } from './context';
import { ATTRIBUTES } from './types';
import { levelFor, rankFor, threshold } from './logic';

const point = (angle: number, radius: number) => ({ x: 220 + Math.cos(angle) * radius, y: 194 + Math.sin(angle) * radius });

export default function CharacterConstellation() {
    const { data, presentations } = useOrion();
    if (!data) return null;
    const { profile } = data;
    const level = levelFor(profile.xp);
    const progress = (profile.xp - threshold(level)) / (threshold(level + 1) - threshold(level));
    const maximum = Math.max(30, ...Object.values(profile.attributes));
    const nodes = ATTRIBUTES.map((attribute, i) => {
        const angle = -Math.PI / 2 + i * Math.PI / 3;
        return { attribute, value: profile.attributes[attribute], angle, ...point(angle, 86 + profile.attributes[attribute] / maximum * 45) };
    });
    return <figure className="character-constellation" aria-label={`Rank ${rankFor(level)}, level ${level}. ${nodes.map(n => `${n.attribute} ${n.value}`).join(', ')}. ${threshold(level + 1) - profile.xp} XP to the next level.`}>
        <svg viewBox="0 0 440 400" aria-hidden="true">
            <g className="star-dust">{Array.from({ length: 32 }, (_, i) => <circle key={i} cx={15 + (i * 89) % 410} cy={12 + (i * 67) % 375} r={i % 4 === 0 ? 1.5 : .7} />)}</g>
            <circle className="constellation-orbit" cx="220" cy="194" r="148" />
            <circle className="constellation-orbit inner" cx="220" cy="194" r="106" />
            <circle className="constellation-xp" cx="220" cy="194" r="148" pathLength="100" strokeDasharray={`${progress * 100} 100`} transform="rotate(-90 220 194)" />
            <g className="constellation-spokes">{nodes.map(n => { const end = point(n.angle, 148); return <line key={n.attribute} x1="220" y1="194" x2={end.x} y2={end.y} />; })}</g>
            <polygon className="constellation-shape" points={nodes.map(n => `${n.x},${n.y}`).join(' ')} />
            {nodes.map(n => {
                const label = point(n.angle, 183);
                return <g key={`${n.attribute}:${n.value}`} className={(presentations[0]?.attributes[n.attribute] ?? 0) > 0 ? 'constellation-changed' : (presentations[0]?.attributes[n.attribute] ?? 0) < 0 ? 'constellation-lost' : ''}><circle className="constellation-node-halo" cx={n.x} cy={n.y} r="8" /><circle className="constellation-node" cx={n.x} cy={n.y} r="3" /><text className="constellation-label" x={label.x} y={label.y - 5} textAnchor="middle">{n.attribute}</text><text className="constellation-value" x={label.x} y={label.y + 16} textAnchor="middle">{n.value}</text></g>;
            })}
            <path className="constellation-sigil" d="m220 126 59 34v68l-59 34-59-34v-68Z" /><circle className="constellation-core" cx="220" cy="194" r="54" />
            <text className="constellation-rank-caption" x="220" y="170" textAnchor="middle">Rank</text>
            <text className="constellation-rank" x="220" y="211" textAnchor="middle">{rankFor(level)}</text>
            <text className="constellation-level" x="220" y="233" textAnchor="middle">Level {level}</text>
        </svg>
        <dl className="constellation-mobile-stats">{nodes.map(n => <div key={n.attribute}><dt><GameIcon name={n.attribute} />{n.attribute}</dt><dd>{n.value}</dd></div>)}</dl>
        <figcaption><span>Your character, taking shape</span><strong>{threshold(level + 1) - profile.xp} XP to level {level + 1}</strong></figcaption>
    </figure>;
}
