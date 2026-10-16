import GameIcon from './GameIcon';
import type { IconName } from './GameIcon';
const icons: IconName[] = ['orbit', 'quest', 'training', 'journal', 'character', 'settings'];
export default function NavIcon({ index }: { index: number }) { return <GameIcon name={icons[index] ?? 'orbit'} />; }
