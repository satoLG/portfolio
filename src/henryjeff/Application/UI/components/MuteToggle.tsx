import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import UIEventBus from '../EventBus';
import { Easing } from '../Animation';

// Use public asset URLs (served from public/henryjeff/)
const volumeOnSrc = '/henryjeff/textures/UI/volume_on.svg';
const volumeOffSrc = '/henryjeff/textures/UI/volume_off.svg';

interface MuteToggleProps {}

const MuteToggle: React.FC<MuteToggleProps> = ({}) => {
    const [isHovering, setIsHovering] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const [muted, setMuted] = useState(false);

    const onMouseDownHandler = useCallback(
        (event: React.MouseEvent) => {
            setIsActive(true);
            event.preventDefault();
            setMuted(!muted);
        },
        [muted]
    );

    const onMouseUpHandler = useCallback(() => {
        setIsActive(false);
    }, []);

    useEffect(() => {
        UIEventBus.dispatch('muteToggle', muted);
    }, [muted]);

    return (
        <div
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            style={styles.container}
            onMouseDown={onMouseDownHandler}
            onMouseUp={onMouseUpHandler}
            className="icon-control-container"
            id="prevent-click"
        >
            <motion.img
                id="prevent-click"
                src={muted ? volumeOffSrc : volumeOnSrc}
                style={{ opacity: isActive ? 0.2 : isHovering ? 0.8 : 1 }}
                width={window.innerWidth < 768 ? 8 : 10}
                animate={
                    isActive ? 'active' : isHovering ? 'hovering' : 'default'
                }
                variants={iconVars}
            />
        </div>
    );
};

const iconVars = {
    hovering: {
        opacity: 0.8,
        transition: {
            duration: 0.1,
            ease: 'easeOut',
        },
    },
    active: {
        scale: 0.8,
        opacity: 0.5,
        transition: {
            duration: 0.1,
            ease: Easing.expOut,
        },
    },
    default: {
        scale: 1,
        opacity: 1,
        transition: {
            duration: 0.2,
            ease: 'easeOut',
        },
    },
};

const styles: StyleSheetCSS = {
    container: {
        background: 'black',
        textAlign: 'center',
        display: 'flex',
        boxSizing: 'border-box',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
    },
};

export default MuteToggle;
