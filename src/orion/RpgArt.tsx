import dashboard from '../assets/rpg/dashboard.webp';
import quest from '../assets/rpg/quest.webp';
import training from '../assets/rpg/training.webp';
import journal from '../assets/rpg/journal.webp';
import character from '../assets/rpg/character.webp';
import settings from '../assets/rpg/settings.webp';

const scenes = { dashboard, quest, training, journal, character, settings };
export type RpgScene = keyof typeof scenes;

// Decorative worlds never encode player state; all live values remain in HTML.
export default function RpgArt({ scene, hero = false }: { scene: RpgScene; hero?: boolean }) {
    return <div className={`rpg-art ${hero ? 'rpg-art-hero' : 'rpg-art-spot'}`} aria-hidden="true">
        <img src={scenes[scene]} alt="" width={hero ? 768 : 480} height={hero ? 512 : 320} loading={hero ? 'eager' : 'lazy'} fetchPriority={hero ? 'high' : 'auto'} decoding="async" draggable={false} />
    </div>;
}
