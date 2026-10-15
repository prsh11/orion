import { ACHIEVEMENTS } from '../gameData';
import AudioFX from '../audio';

export default function Popups({ achievement, levelUp, onCloseAchievement, onCloseLevelUp }: {
    achievement: string | null;
    levelUp: number | null;
    onCloseAchievement: () => void;
    onCloseLevelUp: () => void;
}) {
    return (
        <>
            {achievement && (
                <div className="popup-overlay" onClick={onCloseAchievement}>
                    <div className="achievement-popup" onClick={e => e.stopPropagation()}>
                        <div className="popup-icon">🏆</div>
                        <div className="popup-title">Achievement Unlocked!</div>
                        <div className="popup-name">{ACHIEVEMENTS.find(a => a.id === achievement)?.name}</div>
                        <div className="popup-desc">{ACHIEVEMENTS.find(a => a.id === achievement)?.desc}</div>
                        <button className="btn btn-primary" onClick={() => { AudioFX.press(); onCloseAchievement(); }}>
                            Continue
                        </button>
                    </div>
                </div>
            )}
            {levelUp && (
                <div className="popup-overlay" onClick={onCloseLevelUp}>
                    <div className="achievement-popup" onClick={e => e.stopPropagation()}>
                        <div className="popup-icon">⬆️</div>
                        <div className="popup-title">Level Up!</div>
                        <div className="popup-name">Level {levelUp}</div>
                        <div className="popup-desc">You're getting stronger!</div>
                        <button className="btn btn-primary" onClick={() => { AudioFX.press(); onCloseLevelUp(); }}>
                            Let's Go!
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
