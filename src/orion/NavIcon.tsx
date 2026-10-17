import GameIcon from './GameIcon';
import type { IconName } from './GameIcon';
import type { Tab } from './navigation';
const icons: Record<Tab, IconName> = { Dashboard: 'orbit', Todos: 'todo', Quests: 'quest', Training: 'training', Journal: 'journal', Character: 'character', Settings: 'settings' };
export default function NavIcon({ page }: { page: Tab }) { return <GameIcon name={icons[page]} />; }
