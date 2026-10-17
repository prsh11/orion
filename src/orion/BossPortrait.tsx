import dragon from '../assets/rpg/bosses/dragon.webp';
import guardian from '../assets/rpg/bosses/guardian.webp';
import knight from '../assets/rpg/bosses/knight.webp';
import spectral from '../assets/rpg/bosses/spectral.webp';
import type { BossAvatar } from './types';
const bossAvatars = { dragon: 'Dragon', guardian: 'Stone guardian', knight: 'Armored knight', spectral: 'Spectral creature' } as const;
const portraits = { dragon, guardian, knight, spectral };
export default function BossPortrait({ avatar = 'dragon' }: { avatar?: BossAvatar }) { return <img className="boss-portrait" src={portraits[avatar]} alt="" width="416" height="416" />; }
export function AvatarPicker({ value, onChange }: { value: BossAvatar; onChange: (value: BossAvatar) => void }) {
    return <fieldset className="boss-avatar-picker"><legend>Boss avatar</legend><div>{(Object.keys(bossAvatars) as BossAvatar[]).map(avatar => <label key={avatar}><input type="radio" name="boss-avatar" value={avatar} checked={value === avatar} onChange={() => onChange(avatar)} /><BossPortrait avatar={avatar} /><span>{bossAvatars[avatar]}</span></label>)}</div></fieldset>;
}
