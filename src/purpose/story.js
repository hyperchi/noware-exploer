// Owner confirms PM2.5 is in development; sensor model/specifications are not finalized.
export const roomChapters=[
 {name:'The room',title:'You can’t see most of what’s in your air.',body:'A room can look exactly the same while its air changes. Noware’s PM2.5 feature is being developed to help you notice fine-particle changes.',signal:'PM2.5 preview',status:'In development'},
 {name:'Pets',title:'Pets change the air around them.',body:'Everyday movement can stir particles into the air. This preview shows how Noware could flag a particle change, without identifying specific allergens or their source.',signal:'PM2.5 preview',status:'In development'},
 {name:'Dust',title:'Dust doesn’t stay on the floor.',body:'Disturb a cushion and particles can become airborne. For allergy-conscious homes, Noware is being designed to make fine-particle changes easier to notice—it doesn’t identify allergens or prevent allergies.',signal:'PM2.5 preview',status:'In development'},
 {name:'The window',title:'Outside air becomes inside air.',body:'An open window can let outdoor particles inside. This preview illustrates how Noware could show a rise in fine particles.',signal:'PM2.5 preview',status:'In development'},
 {name:'Cooking',title:'Cooking can change your air in minutes.',body:'Cooking can release airborne particles. Preview a PM2.5 response as levels rise—and an indication that settles as they fall.',signal:'PM2.5 preview',status:'Change illustrated'},
];
export const roomChapterAt=p=>Math.min(roomChapters.length-1,Math.floor(Math.max(0,Math.min(1,p))*roomChapters.length));
