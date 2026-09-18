/* Badr Grappling — the committed photo set.
 *
 * Images live in /assets/gallery and are keyed by branch slug, so a new
 * branch drops its photos in here alongside its database row. Alt text is
 * written per photo — it is read out loud to people using a screen reader,
 * so it describes the picture rather than repeating the club name.
 */
export const GALLERY = {
  london: [
    { src: 'assets/gallery/team-line-up.jpg', w: 2200, h: 1467,
      alt: 'The Badr Grappling squad lined up together in the hall, beneath a band of Arabic calligraphy running along the wall.',
      caption: 'The squad, Brondesbury Road' },

    { src: 'assets/gallery/team-mats.jpg', w: 1440, h: 1002,
      alt: 'Members standing and kneeling in two rows on the blue mats at the end of a session.',
      caption: 'End of a Friday session' },

    { src: 'assets/gallery/talk-before-training.jpg', w: 1280, h: 853,
      alt: 'Members sitting on the mats in a circle listening to a talk before training begins.',
      caption: 'A word before we train' },

    { src: 'assets/gallery/hall-circle.jpg', w: 619, h: 1100,
      alt: 'The group gathered on the mats in the hall, seen from the back of the room.',
      caption: 'The hall on a Friday' },

    { src: 'assets/gallery/coach-instruction.jpg', w: 620, h: 1100,
      alt: 'A coach mid-sentence, walking the group through a technique at the front of the hall.',
      caption: 'Coaching the detail' },

    { src: 'assets/gallery/takedown-drill.jpg', w: 620, h: 1100,
      alt: 'Two members drilling a takedown, one lifting the other clear of the mat.',
      caption: 'Drilling takedowns' },
  ],
};

export const galleryFor = (slug) => GALLERY[slug] ?? [];
