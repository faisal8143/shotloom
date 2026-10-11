"""Cinematography presets.

Shot size, lens and lighting go into each AI prompt the way a director of
photography would describe the shot. A project *look* adds a matching style
line to every prompt and a colour grade + film finish on export, so AI clips
and still-motion clips end up looking like one film.
"""

SHOT_SIZES = {
    "auto": "",
    "extreme wide": "extreme wide establishing shot",
    "wide": "wide shot",
    "medium": "medium shot",
    "medium close-up": "medium close-up",
    "close-up": "close-up shot",
    "extreme close-up": "extreme close-up, fine detail",
    "over-the-shoulder": "over-the-shoulder shot",
    "low angle": "low-angle shot looking up",
    "high angle": "high-angle shot looking down",
    "aerial": "aerial drone shot",
}

LENSES = {
    "auto": "",
    "24mm wide": "24mm wide-angle lens, deep focus",
    "35mm": "35mm lens, natural perspective",
    "50mm": "50mm lens",
    "85mm portrait": "85mm lens, shallow depth of field, soft bokeh",
    "anamorphic": "anamorphic lens, oval bokeh, subtle horizontal lens flare",
    "telephoto": "telephoto lens, compressed background, shallow focus",
    "macro": "macro lens, razor-thin focus",
}

LIGHTING = {
    "auto": "",
    "golden hour": "warm golden-hour sunlight, long soft shadows",
    "blue hour": "blue-hour twilight, cool ambient light, glowing windows",
    "low-key noir": "low-key lighting, deep shadows, hard rim light",
    "neon night": "neon-lit night, wet reflective streets, cyan and magenta glow",
    "overcast soft": "soft overcast daylight, muted tones",
    "moonlight": "cold moonlight, blue tint, soft shadows",
    "candlelight": "warm flickering candlelight, practical light sources",
    "harsh midday": "harsh midday sun, crisp high-contrast shadows",
    "soft key": "soft key light with gentle fill, clean separation",
    "fluorescent office": "flat fluorescent office light, slightly green tint",
}

# style: appended to AI prompts.  grade: ffmpeg filter applied on export.
LOOKS = {
    "none": {"style": "", "grade": ""},
    "cinematic film": {
        "style": "cinematic film still, shot on Kodak Vision3 film, natural skin tones, rich contrast",
        "grade": "curves=preset=medium_contrast,eq=saturation=0.92:gamma=0.98,"
                 "colorbalance=rs=0.03:bs=-0.03:rh=0.02:bh=-0.04",
    },
    "documentary": {
        "style": "documentary cinematography, realistic, natural light, handheld feel",
        "grade": "eq=contrast=1.04:saturation=0.9,colorbalance=bm=0.01",
    },
    "noir thriller": {
        "style": "moody thriller cinematography, low-key lighting, deep shadows, desaturated",
        "grade": "curves=preset=strong_contrast,eq=saturation=0.6:gamma=0.95,colorbalance=bs=0.04:bm=0.02",
    },
    "teal & orange": {
        "style": "blockbuster cinematography, teal and orange color palette, high production value",
        "grade": "curves=preset=medium_contrast,colorbalance=rs=-0.06:bs=0.08:rh=0.07:bh=-0.07,"
                 "eq=saturation=1.08",
    },
    "vintage 70s": {
        "style": "1970s film look, warm faded colors, soft halation, 35mm film grain",
        "grade": "curves=preset=lighter,eq=saturation=0.8:contrast=0.92,colorbalance=rs=0.06:gs=0.02:bs=-0.06",
    },
    "cold corporate": {
        "style": "sleek corporate thriller look, cool steel-blue tones, clean modern interiors",
        "grade": "eq=saturation=0.82:contrast=1.06,colorbalance=rs=-0.03:bs=0.05:rm=-0.02:bm=0.03",
    },
}

DEFAULT_QUALITY_WORDS = "highly detailed, sharp focus, realistic motion, coherent anatomy"


def describe(size="auto", lens="auto", light="auto"):
    parts = [SHOT_SIZES.get(size or "auto", ""), LENSES.get(lens or "auto", ""),
             LIGHTING.get(light or "auto", "")]
    return ", ".join(p for p in parts if p)
