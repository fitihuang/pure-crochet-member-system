function getGradeById(gradeId) {
	var grades = getSheetAsObjects('Grade');
	for (var i = 0; i < grades.length; i++) {
		if (grades[i]['會員等級ID'] === gradeId) {
			return grades[i];
		}
	}
	return null;
}

function getGradeIdByName(gradeName) {
	var grades = getSheetAsObjects('Grade');
	for (var i = 0; i < grades.length; i++) {
		if (grades[i]['會員等級名稱'] === gradeName) {
			return grades[i]['會員等級ID'];
		}
	}
	return null;
}

// 區間比對：from <= 付費次數 < to，to 留空代表沒有上限
// to 採不含上限，這樣「一般會員0~5」「金牌會員5以上」在剛好5次時不會重疊，滿5次直接算金牌
function determineGradeByPaidCount(paidCount) {
	var grades = getSheetAsObjects('Grade');
	for (var i = 0; i < grades.length; i++) {
		var grade = grades[i];
		var from = Number(grade['會員等級判斷from']);
		var to = grade['會員等級判斷to'];
		var withinUpperBound = (to === '' || to === null || to === undefined) || paidCount < Number(to);
		if (paidCount >= from && withinUpperBound) {
			return grade;
		}
	}
	return null;
}
