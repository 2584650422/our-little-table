const test=require('node:test'),assert=require('node:assert/strict')
function page(path){let definition;global.Page=p=>{definition=p};delete require.cache[require.resolve(path)];require(path);delete global.Page;return {...definition,data:structuredClone(definition.data),setData(value){Object.assign(this.data,value)}}}
test('同一天可同时标记纪念日和当天记录，选中日期只显示当天内容',()=>{
 const p=page('../miniprogram/pages/calendar/calendar');p.data.month='2026-11';p.data.selected='2026-11-15';p._events=[{id:1,nextDate:'2026-11-15',kind:'birthday'},{id:2,nextDate:'2026-11-15',kind:'diary',content:'去了北京'},{id:3,nextDate:'2026-11-16',kind:'diary'}];p.draw();const day=p.data.cells.find(d=>d.day===15);assert.equal(day.marked,true);assert.equal(day.diary,true);assert.equal(day.selected,true);assert.deepEqual(p.data.dayEvents.map(e=>e.id),[1,2]);assert.equal(p.data.cells.find(d=>d.day===16).marked,false)
})
test('编辑器提交农历年月日和闰月，日记提交正文和公历日期',async()=>{
 const api=require('../miniprogram/services/life'),original=api.saveEvent;let saved;api.saveEvent=async data=>{saved=data};global.wx={navigateBack(){}};
 try{const p=page('../miniprogram/pages/life-edit/life-edit');p.setData({title:'出发',kindIndex:0,calendarIndex:1,lunarIndex:[126,0,0],lunarLeap:false});await p.save();assert.deepEqual(saved.lunarDate,{year:2027,month:1,day:1,leap:false});assert.equal(saved.calendarType,'lunar');p.setData({kindIndex:3,title:'去了北京',content:'一起逛了故宫。',eventDate:'2026-11-01'});await p.save();assert.equal(saved.kind,'diary');assert.equal(saved.content,'一起逛了故宫。');assert.equal(saved.calendarType,'solar');assert.equal(saved.lunarDate,undefined);assert.equal(saved.remindDays,0)}finally{api.saveEvent=original;delete global.wx}
})
test('农历选择器显示中文月份和传统日期，闰月标签同步更新',()=>{
 const p=page('../miniprogram/pages/life-edit/life-edit');assert.deepEqual(p.data.lunarRanges[1].slice(0,3),['正月','二月','三月']);assert.deepEqual(p.data.lunarRanges[2].slice(0,11).slice(-3),['初九','初十','十一']);p.setData({lunarIndex:[126,0,20]});p.field({currentTarget:{dataset:{field:'lunarLeap'}},detail:{value:true}});assert.equal(p.data.lunarLabel,'2027年 闰正月廿一')
})
test('双方创建的当天记录使用相同类型和圆点，记录人不随查看者改变',()=>{
 const life=require('../miniprogram/utils/life'),p=page('../miniprogram/pages/calendar/calendar');p.data.month='2026-11';p.data.selected='2026-11-05';
 p._events=[{id:1,kind:'diary',nextDate:'2026-11-05',createdBy:1,creatorName:'小林'},{id:2,kind:'diary',nextDate:'2026-11-05',createdBy:2,creatorName:'小周'}].map(life.event);p.draw();
 assert.equal(p.data.dayEvents.every(e=>e.isDiary),true);assert.deepEqual(p.data.dayEvents.map(e=>e.creatorLabel),['小林','小周']);const day=p.data.cells.find(d=>d.day===5);assert.equal(day.diary,true);assert.equal(day.marked,false);
 p.avatarError({currentTarget:{dataset:{id:1}}});assert.equal(p.data.dayEvents[0].creatorAvatarUrl,null);assert.equal(p.data.dayEvents[0].creatorInitial,'小');
})
test('日历两个入口明确区分记录与重要日子，普通新增默认当天记录',async()=>{
 let navigated;global.wx={navigateTo:o=>{navigated=o.url}};
 try{
 const calendar=page('../miniprogram/pages/calendar/calendar');calendar.data.selected='2026-11-04';calendar.addDiary();assert.match(navigated,/kind=diary&date=2026-11-04/);calendar.add();assert.match(navigated,/kind=important&date=2026-11-04/);
 const editor=page('../miniprogram/pages/life-edit/life-edit');await editor.onLoad({date:'2026-11-04'});assert.equal(editor.data.kindIndex,3);await editor.onLoad({kind:'important',date:'2026-11-04'});assert.equal(editor.data.kindIndex,0);assert.equal(editor.data.importantKinds.length,3);
 }finally{delete global.wx}
})
test('在一起天数跟随所选日期，起始日第1天，起始日之前显示相差天数',()=>{
 const life=require('../miniprogram/utils/life');assert.equal(life.togetherLabel('2026-04-30','2026-11-05'),'在一起第 190 天');assert.equal(life.togetherLabel('2026-04-30','2026-11-11'),'在一起第 196 天');assert.equal(life.togetherLabel('2026-04-30','2026-04-30'),'在一起第 1 天');assert.equal(life.togetherLabel('2026-04-30','2026-04-29'),'距离在一起还有 1 天');assert.equal(life.togetherLabel(null,'2026-11-11'),'从哪一天开始？');assert.equal(life.togetherLabel('2024-02-28','2024-03-01'),'在一起第 3 天');
 const p=page('../miniprogram/pages/calendar/calendar');p._events=[];p.data.month='2026-11';p.data.summary={anniversary:'2026-04-30',togetherDays:190};p.select({currentTarget:{dataset:{date:'2026-11-11'}}});assert.equal(p.data.togetherLabel,'在一起第 196 天');p.select({currentTarget:{dataset:{date:'2026-11-05'}}});assert.equal(p.data.togetherLabel,'在一起第 190 天');
 p.load=()=>{};p.move({currentTarget:{dataset:{delta:1}}});assert.equal(p.data.selected,'2026-12-01');assert.equal(p.data.togetherLabel,'在一起第 216 天');
})

test('当天记录显示真实创建时间到分钟，补写旧日期时不使用记录所属日',()=>{
 const life=require('../miniprogram/utils/life')
 const base={kind:'diary',nextDate:'2026-10-01',creatorName:'小林'}
 assert.equal(life.event({...base,createdAt:'2026-11-13 17:24:31'}).createdAtLabel,'2026-11-13 17:24')
 assert.equal(life.event({...base,createdAt:'2026-11-13T00:02:05'}).createdAtLabel,'2026-11-13 00:02')
 assert.equal(life.event(base).createdAtLabel,'')
 assert.equal(life.event({...base,createdAt:'invalid'}).createdAtLabel,'')
})

test('互动紫色标记与当天记录、重要日子可同时出现，原记录查看方式保持不变',()=>{
 const p=page('../miniprogram/pages/calendar/calendar')
 p.data.month='2026-11';p.data.selected='2026-11-18'
 p._events=[{id:1,nextDate:'2026-11-18',kind:'diary'},{id:2,nextDate:'2026-11-18',kind:'birthday'}]
 p._thoughtMonthCounts={'2026-11-18':3};p.draw()
 const cell=p.data.cells.find(d=>d.day===18)
 assert.equal(cell.diary,true);assert.equal(cell.marked,true);assert.equal(cell.interaction,true)
 assert.equal(p.data.dayEvents.length,2)
 assert.equal(p.data.cells.find(d=>d.day===17).interaction,false)
})
